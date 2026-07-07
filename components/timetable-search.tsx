"use client"

import type React from "react"
import { useMemo, useState } from "react"
import { StationSearch } from "@/components/station-search"
import { gtfsParser, type GTFSStop } from "@/lib/gtfs-parser"
import { Clock, Train, Bus, ArrowLeft } from "lucide-react"

// 時刻表（駅ごとの発車時刻一覧）。
// - TimetableSearch: トップページ下部の駅ピッカー。駅を選ぶと親に通知して時刻表ページへ。
// - TimetableResults: 乗換案内の結果と同様の「別ページ」。上り/下り別・時台ごとに表示。
// 同梱データは8〜11時台を4時間ごとに繰り返し展開済みなので、ほぼ全日分が表示される。

interface Departure {
  time: string
  routeName: string
  routeType: number
  routeColor?: string
  headsign?: string
  platform?: string
  direction: number
}

function timeToMinutes(t: string): number {
  const [h, m, s] = t.split(":").map(Number)
  return (h || 0) * 60 + (m || 0) + (s || 0) / 60
}

function getRouteColor(routeColor?: string): string {
  if (!routeColor || routeColor.trim() === "") return "#0891b2"
  if (/^[0-9A-Fa-f]{6}$/.test(routeColor)) return `#${routeColor}`
  if (routeColor.startsWith("#")) return routeColor
  return "#0891b2"
}

function directionLabel(dir: number): string {
  return dir === 1 ? "上り" : "下り"
}

// 系統が複雑で番線（のりば）別カラム表示にする分岐駅。それ以外は上り/下り別。
const COMPLEX_STATIONS = new Set(["中原台", "島北出坂", "上砥"])

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex flex-shrink-0 items-center justify-center w-14 px-2 py-1.5 text-xs font-medium text-white bg-gray-500 rounded">
      {children}
    </span>
  )
}

// 番線コードの並び替え（数値優先、空欄は末尾）
function platformSort(a: string, b: string): number {
  if (a === b) return 0
  if (a === "") return 1
  if (b === "") return -1
  const na = Number.parseInt(a, 10)
  const nb = Number.parseInt(b, 10)
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
  return a.localeCompare(b)
}

// 指定駅（同一駅グループ）の発車を取得
function getDepartures(stop: GTFSStop): Departure[] {
  const ids = new Set(gtfsParser.getRelatedStopIds(stop.stop_id))
  const stopTimes = gtfsParser.getStopTimes()

  // 便ごとに停車順で整列
  const byTrip = new Map<string, typeof stopTimes>()
  for (const st of stopTimes) {
    const arr = byTrip.get(st.trip_id)
    if (arr) arr.push(st)
    else byTrip.set(st.trip_id, [st])
  }
  for (const arr of byTrip.values()) arr.sort((a, b) => a.stop_sequence - b.stop_sequence)

  const list: Departure[] = []
  for (const [tripId, seq] of byTrip) {
    const trip = gtfsParser.getTrip(tripId)
    if (!trip) continue
    const route = gtfsParser.getRoute(trip.route_id)
    if (route?.route_id === "TAXI") continue
    for (let i = 0; i < seq.length; i++) {
      const st = seq[i]
      if (!ids.has(st.stop_id)) continue
      if (i === seq.length - 1) continue // 終着は除外
      // 分岐駅は路線データ上に同一stop_idが連続して現れる。重複側（次が同一駅）はスキップして
      // 実際の発車（次が別の駅）の行を採用する
      if (seq[i + 1].stop_id === st.stop_id) continue
      list.push({
        time: st.departure_time || st.arrival_time,
        routeName: route?.route_short_name || route?.route_long_name || "",
        routeType: route?.route_type ?? 0,
        routeColor: route?.route_color,
        headsign: trip.trip_headsign,
        platform: st.platform_code || "",
        direction: trip.direction_id ?? 0,
      })
    }
  }
  return list.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time))
}

// ---------- トップページ下部の駅ピッカー ----------
export function TimetableSearch({ onSelect }: { onSelect: (stop: GTFSStop) => void }) {
  const [station, setStation] = useState("")

  return (
    <div className="rounded-lg border border-border shadow-sm">
      <div className="flex items-center gap-2 rounded-t-lg bg-green-700 px-4 py-2.5 text-white">
        <Clock className="h-5 w-5" />
        <span className="text-base font-bold">時刻表</span>
      </div>
      <div className="space-y-2 rounded-b-lg bg-card p-4">
        <div className="flex items-center gap-2">
          <FieldLabel>駅</FieldLabel>
          <div className="flex-1">
            <StationSearch
              value={station}
              onChange={(value, s) => {
                setStation(value)
                if (s) onSelect(s)
              }}
              placeholder="駅、バス停"
              label="時刻表を見る駅"
              hideLabel
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">駅・バス停を選ぶと時刻表を表示します。</p>
      </div>
    </div>
  )
}

// ---------- 時刻表ページ（別ページ表示・番線別カラム） ----------
export function TimetableResults({
  stop,
  onBack,
  onStation,
}: {
  stop: GTFSStop
  onBack: () => void
  onStation: (stop: GTFSStop) => void
}) {
  const [changeValue, setChangeValue] = useState("")
  const [activeCol, setActiveCol] = useState<string | null>(null)

  const all = useMemo(() => getDepartures(stop), [stop])

  // 中原台・島北出坂・上砥は系統が複雑なので番線でカラム分け。その他は上り/下りでカラム分け。
  const usesPlatform = COMPLEX_STATIONS.has(stop.stop_name)

  // カラム一覧
  const columns = useMemo(() => {
    const set = new Set<string>()
    for (const d of all) set.add(usesPlatform ? d.platform ?? "" : String(d.direction))
    const arr = Array.from(set)
    return usesPlatform ? arr.sort(platformSort) : arr.sort((a, b) => Number(a) - Number(b))
  }, [all, usesPlatform])

  const col = activeCol != null && columns.includes(activeCol) ? activeCol : columns[0] ?? ""

  // カラムごとの主な行先（方面表示用）
  const colMeta = useMemo(() => {
    const destCount = new Map<string, Map<string, number>>()
    for (const d of all) {
      const k = usesPlatform ? d.platform ?? "" : String(d.direction)
      if (!destCount.has(k)) destCount.set(k, new Map())
      const h = d.headsign || ""
      if (h) destCount.get(k)!.set(h, (destCount.get(k)!.get(h) || 0) + 1)
    }
    const meta = new Map<string, string[]>()
    for (const [k, dc] of destCount) {
      meta.set(k, [...dc.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]))
    }
    return meta
  }, [all, usesPlatform])

  // 選択中カラムの発車を時台ごとにグルーピング
  const byHour = useMemo(() => {
    const map = new Map<number, Departure[]>()
    for (const d of all) {
      if (columns.length > 1 && (usesPlatform ? d.platform ?? "" : String(d.direction)) !== col) continue
      const h = Math.floor(timeToMinutes(d.time) / 60)
      if (!map.has(h)) map.set(h, [])
      map.get(h)!.push(d)
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [all, col, columns.length, usesPlatform])

  const colLabel = (k: string) => (usesPlatform ? (k ? `${k}番線` : "発車") : directionLabel(Number(k)))
  const destsLabel = (dests: string[]) =>
    dests.slice(0, 2).map((h) => h.replace(/行き$/, "")).join("・") + (dests.length ? "方面" : "")

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4 lg:max-w-4xl">
      {/* ヘッダー：戻る・駅名・駅切替 */}
      <div className="rounded-lg border border-border shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg bg-green-700 px-4 py-2.5 text-white">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            <span className="text-base font-bold">時刻表</span>
            <span className="font-bold">{stop.stop_name}</span>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 rounded bg-white/15 px-3 py-1 text-sm font-medium hover:bg-white/25"
          >
            <ArrowLeft className="h-4 w-4" />
            戻る
          </button>
        </div>

        <div className="rounded-b-lg bg-card p-3">
          <div className="flex items-center gap-2">
            <FieldLabel>駅</FieldLabel>
            <div className="flex-1">
              <StationSearch
                value={changeValue}
                onChange={(value, s) => {
                  setChangeValue(value)
                  if (s) {
                    onStation(s)
                    setChangeValue("")
                    setActiveCol(null)
                  }
                }}
                placeholder="別の駅・バス停に切り替え"
                label="時刻表を見る駅"
                hideLabel
              />
            </div>
          </div>
        </div>
      </div>

      {/* カラムタブ（複数カラムがあるときのみ）。番線別 or 上り/下り別 */}
      {columns.length > 1 && (
        <div className="flex overflow-x-auto rounded-lg border border-border">
          {columns.map((k) => {
            const active = k === col
            const dests = colMeta.get(k) || []
            return (
              <button
                key={k}
                type="button"
                onClick={() => setActiveCol(k)}
                className={`flex min-w-[5.5rem] flex-1 flex-col items-center gap-0.5 whitespace-nowrap px-3 py-2 transition-colors ${
                  active ? "bg-green-700 text-white" : "bg-card text-foreground hover:bg-accent"
                }`}
              >
                <span className="text-sm font-bold">{colLabel(k)}</span>
                {dests.length > 0 && (
                  <span className={`text-[10px] leading-tight ${active ? "text-white/85" : "text-muted-foreground"}`}>
                    {destsLabel(dests)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* 時刻表本体 */}
      <div className="overflow-hidden rounded-lg border border-border shadow-sm">
        {byHour.length === 0 ? (
          <p className="bg-card py-8 text-center text-sm text-muted-foreground">
            {stop.stop_name} の発車時刻データがありません。
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-muted text-sm">
                <th className="w-12 border-b border-border px-2 py-2 font-medium">時</th>
                <th className="border-b border-border px-2 py-2 text-left font-medium">
                  {columns.length > 1 ? `${colLabel(col)}（分・種別・行先）` : "分・種別・行先"}
                </th>
              </tr>
            </thead>
            <tbody>
              {byHour.map(([hour, list]) => (
                <tr key={hour} className="border-b border-border align-top last:border-b-0">
                  <td className="w-12 bg-muted/60 px-2 py-2 text-center text-lg font-bold tabular-nums">{hour}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((d, i) => {
                        const color = getRouteColor(d.routeColor)
                        return (
                          <div
                            key={i}
                            className="flex w-[4.5rem] flex-col items-center rounded border bg-white px-1 py-1 text-center leading-tight"
                            style={{ borderColor: color }}
                          >
                            <span className="text-base font-bold tabular-nums" style={{ color }}>
                              {String(Math.floor(timeToMinutes(d.time) % 60)).padStart(2, "0")}
                            </span>
                            <span className="mt-0.5 flex items-center gap-0.5 text-[10px] font-medium" style={{ color }}>
                              {d.routeType === 3 ? <Bus className="h-2.5 w-2.5" /> : <Train className="h-2.5 w-2.5" />}
                              {d.routeName}
                            </span>
                            {d.headsign && (
                              <span className="text-[9px] text-muted-foreground">{d.headsign}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
