"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { TimetableSearch } from "@/components/timetable-search"
import { StopMapPicker, type PickerStop } from "@/components/stop-map-picker"
import { useGtfsData } from "@/hooks/use-gtfs-data"
import { gtfsParser } from "@/lib/gtfs-parser"
import { stationCoordinateManager, type StationCoordinates } from "@/lib/station-coordinates"
import { busMapSettingsManager, type BusMapSettings } from "@/lib/bus-map"
import { RAIL_LINES } from "@/lib/rail-lines"
import { routeColor } from "@/lib/train-display"
import { RefreshCw, Map as MapIcon } from "lucide-react"

// /timetable のインデックス。駅/停留所を選ぶと /timetable/[stopId] へ遷移。
// 名前で検索するほか、地図（鉄道駅＝四角／バス停＝丸）からも選べる。
export function TimetableIndex() {
  const router = useRouter()
  const { dataLoaded, isLoadingData } = useGtfsData()
  const [showMap, setShowMap] = useState(false)
  const [coords, setCoords] = useState<StationCoordinates>({})
  const [busMap, setBusMap] = useState<BusMapSettings>({ imageUrl: "", refs: [] })

  useEffect(() => {
    stationCoordinateManager.load().then(setCoords).catch(() => {})
    busMapSettingsManager.load().then(setBusMap).catch(() => {})
  }, [])

  // 地図に載せる駅・バス停（いずれかの便が停車するもの）と、路線・系統の並び
  const mapData = useMemo(() => {
    const empty = { stops: [] as PickerStop[], routes: [] as { name: string; color: string; stops: string[] }[], idByName: new Map<string, string>() }
    if (!dataLoaded) return empty
    const stopById = new Map(gtfsParser.getStops().map((s) => [s.stop_id, s]))
    const routes = gtfsParser.getRoutes()
    const routeById = new Map(routes.map((r) => [r.route_id, r]))
    const routeIdByTrip = new Map(gtfsParser.getTrips().map((t) => [t.trip_id, t.route_id]))
    const kindByName = new Map<string, "rail" | "bus">()
    const idByName = new Map<string, string>()
    const namesByTrip = new Map<string, { routeId: string; names: string[] }>()

    for (const st of gtfsParser.getStopTimes()) {
      const stop = stopById.get(st.stop_id)
      const routeId = routeIdByTrip.get(st.trip_id)
      if (!stop || !routeId) continue
      const kind: "rail" | "bus" = routeById.get(routeId)?.route_type === 3 ? "bus" : "rail"
      // 鉄道優先（バス停は「(バス)〇〇」と別名なので実際は衝突しない）
      if (!kindByName.has(stop.stop_name) || kind === "rail") kindByName.set(stop.stop_name, kind)
      if (!idByName.has(stop.stop_name)) idByName.set(stop.stop_name, stop.stop_id)
      const cur = namesByTrip.get(st.trip_id) || { routeId, names: [] }
      if (cur.names[cur.names.length - 1] !== stop.stop_name) cur.names.push(stop.stop_name)
      namesByTrip.set(st.trip_id, cur)
    }
    // 系統ごとの代表停車順（最も停車数が多い便）
    const seqByRoute = new Map<string, string[]>()
    for (const { routeId, names } of namesByTrip.values()) {
      if ((seqByRoute.get(routeId)?.length || 0) < names.length) seqByRoute.set(routeId, names)
    }
    // 鉄道は線区定義（rail-lines）の駅並びを使うと線がきれいに繋がる
    const routeLines = [
      ...RAIL_LINES.map((l) => ({ name: l.name, color: routeColor(l.color), stops: l.segments.flat() })),
      ...routes
        .filter((r) => r.route_type === 3 && seqByRoute.has(r.route_id))
        .map((r) => ({
          name: r.route_short_name || r.route_long_name || r.route_id,
          color: routeColor(r.route_color),
          stops: seqByRoute.get(r.route_id) || [],
        })),
    ]
    const stops: PickerStop[] = [...kindByName.entries()].map(([name, kind]) => ({ name, kind }))
    return { stops, routes: routeLines, idByName }
  }, [dataLoaded])

  const goToStop = (name: string) => {
    const id = mapData.idByName.get(name)
    if (id) router.push(`/timetable/${encodeURIComponent(id)}`)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 lg:max-w-4xl">
      <h1 className="text-2xl font-bold text-foreground">時刻表</h1>
      {isLoadingData ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin" />
          データを読み込み中...
        </div>
      ) : dataLoaded ? (
        <div className="space-y-4">
          <TimetableSearch onSelect={(stop) => router.push(`/timetable/${encodeURIComponent(stop.stop_id)}`)} />
          <div>
            <button
              type="button"
              onClick={() => setShowMap((v) => !v)}
              className={`flex items-center gap-1.5 rounded border px-3 py-2 text-sm ${
                showMap ? "border-green-700 bg-green-700 text-white" : "border-border bg-background hover:bg-accent"
              }`}
            >
              <MapIcon className="h-4 w-4" />
              地図から選ぶ
            </button>
            {showMap && (
              <div className="mt-2">
                <StopMapPicker
                  coords={coords}
                  stops={mapData.stops}
                  routes={mapData.routes}
                  busMap={busMap}
                  selected=""
                  onSelect={goToStop}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground">時刻表を表示するにはデータの登録が必要です。</p>
      )}
    </div>
  )
}
