import { type NextRequest, NextResponse } from "next/server"
import embeddedGtfs from "@/data/embedded-gtfs.json"
import embeddedBus from "@/data/embedded-bus.json"
import { readJsonFile } from "@/lib/server/file-store"
import type { StationCoordinates } from "@/lib/station-coordinates"
import {
  computeTrainPositions,
  nowMinutesInTokyo,
  type TripLite,
  type StopTimeLite,
  type RouteLite,
  type TrainDelay,
} from "@/lib/train-position"

// 列車現在位置API（公開GET）。
// 実時間(JST)で運行中の各列車について、駅間を時間比で補間したワールド座標(X/Z)・遅延・次駅を返す。
// Dynmapマーカー描画など外部システムがポーリングして利用する想定。
// 駅座標・遅延・運休は管理画面で設定した shared-data から読み込む。

export const dynamic = "force-dynamic"

const SHARED_FILE = "shared-data.json"

interface AnyDataset {
  id: string
  stops: { stop_id: string; stop_name: string }[]
  routes: RouteLite[]
  trips: TripLite[]
  stopTimes: StopTimeLite[]
}

interface SharedSlice {
  delayInfo?: { tripId: string; delayMinutes: number; status: TrainDelay["status"] }[]
  tripVisibilitySettings?: Record<string, boolean>
  stationCoordinates?: StationCoordinates
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // アクティブな鉄道データセット＋同梱バスをマージ
    const gtfs = embeddedGtfs as unknown as { datasets: AnyDataset[]; activeDatasetId: string }
    const ds = gtfs.datasets.find((d) => d.id === gtfs.activeDatasetId) || gtfs.datasets[0]
    const bus = embeddedBus as unknown as Omit<AnyDataset, "id">

    const stops = [...ds.stops, ...bus.stops]
    const routes = [...ds.routes, ...bus.routes]
    const trips = [...ds.trips, ...bus.trips]
    const stopTimes = [...ds.stopTimes, ...bus.stopTimes]

    const stopNameById = new Map<string, string>()
    for (const s of stops) if (!stopNameById.has(s.stop_id)) stopNameById.set(s.stop_id, s.stop_name)

    // 管理画面で設定した座標・遅延・運休
    const shared = (await readJsonFile<SharedSlice>(SHARED_FILE)) || {}
    const coordsByName = shared.stationCoordinates || {}
    const visibilityByTripId = shared.tripVisibilitySettings || {}
    const delaysByTripId = new Map<string, TrainDelay>()
    for (const d of shared.delayInfo || []) {
      delaysByTripId.set(d.tripId, { delayMinutes: d.delayMinutes, status: d.status })
    }

    // 時刻: ?time=HH:MM 指定があればそれを、無ければ実時間(JST)
    const timeParam = searchParams.get("time")
    const nowMinutes = timeParam
      ? (() => {
          const [h, m] = timeParam.split(":").map(Number)
          return (h || 0) * 60 + (m || 0)
        })()
      : nowMinutesInTokyo()

    const world = searchParams.get("world") || "world"

    const trains = computeTrainPositions({
      trips,
      stopTimes,
      routes,
      stopNameById,
      coordsByName,
      delaysByTripId,
      visibilityByTripId,
      nowMinutes,
    })

    const hh = Math.floor(nowMinutes / 60)
    const mm = Math.floor(nowMinutes % 60)
    const timeStr = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`

    return NextResponse.json(
      {
        success: true,
        world,
        time: timeStr,
        generatedAt: new Date().toISOString(),
        count: trains.length,
        coordinatesRegistered: Object.keys(coordsByName).length,
        // y は高さデータが無いため暫定の既定値。マーカー側で必要に応じて上書き可。
        trains: trains.map((t) => ({ ...t, world, y: 64 })),
      },
      { headers: CORS },
    )
  } catch (error) {
    console.error("[gtfs] train-positions GET error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500, headers: CORS })
  }
}
