"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { gtfsParser } from "@/lib/gtfs-parser"
import { delayManager } from "@/lib/delay-manager"
import { computeTrainRunStates, type TrainRunState, type TrainDelay } from "@/lib/train-position"
import {
  MAP_LINES,
  MAP_STATIONS,
  MAP_VIEWBOX,
  linePath,
  linesAtStation,
  mapLineColor,
  placeOnMap,
  type MapPlacement,
} from "@/lib/route-map-layout"
import { buildOperationSchedule } from "@/lib/estimate-delay"
import { stationCoordinateManager, type StationCoordinates } from "@/lib/station-coordinates"
import {
  locateRtmMarkers,
  resolveRtmStatesWithSchedule,
  type RtmMarker,
} from "@/lib/rtm-locate"
import { Train, Minus, Plus, RotateCcw, List, X, Maximize2, Minimize2 } from "lucide-react"

// 管理画面用の路線図（運行状況マップ）。在線表示(/live)は1線ずつ縦に並べるのに対し、
// こちらは路線網全体を1枚の模式図に描き、列車を線上に配置する。ひとまず列車のみ（バスは対象外）。
// 表示元は /live と同じく「ダイヤ予測（時刻表＋実時間）」と「Dynmap実位置（RTMマーカー）」の切替式。

const REFRESH_MS = 10000
const ICON_OFFSET = 34 // 線からアイコンまでの距離
const STACK_STEP = 32 // 同じ位置に複数いるときのずらし量

function nowMinutesLocal(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

function clockNow(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

interface Placed {
  state: TrainRunState
  pos: MapPlacement
  lineName: string
  color: string
  cx: number // アイコン中心（線から法線方向へずらした位置）
  cy: number
}

// 列車がどの線区にいるか（図に描いてある線区のうち、from/toを含むもの）
function lineOfState(t: TrainRunState): string | null {
  const names = (n: string) => linesAtStation(n)
  if (t.atStation) {
    const ls = names(t.fromStop)
    if (ls.length === 0) return null
    // 分岐駅では次駅も含む線区を優先
    if (t.nextStop) {
      const nx = names(t.nextStop)
      const both = ls.find((l) => nx.includes(l))
      if (both) return both
    }
    return ls[0]
  }
  const a = names(t.fromStop)
  const b = names(t.toStop)
  const both = a.find((l) => b.includes(l))
  return both || a[0] || null
}

export function RouteStatusMap() {
  const [ready, setReady] = useState(false)
  const [now, setNow] = useState(nowMinutesLocal())
  const [updatedAt, setUpdatedAt] = useState(clockNow())
  const [tick, setTick] = useState(0)
  const [visibility, setVisibility] = useState<Record<string, boolean>>({})
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(1)
  const [showSidebar, setShowSidebar] = useState(true)
  const [expanded, setExpanded] = useState(false) // 全画面表示
  const [selected, setSelected] = useState<TrainRunState | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  // 表示元: ダイヤ予測（時刻表）/ Dynmap実位置（RTMマーカー）
  const [source, setSource] = useState<"schedule" | "dynmap">("schedule")
  const [rtmStates, setRtmStates] = useState<TrainRunState[]>([])
  const [rtmUnmapped, setRtmUnmapped] = useState<RtmMarker[]>([])
  const [rtmError, setRtmError] = useState<string | null>(null)
  const [coords, setCoords] = useState<StationCoordinates>({})
  const prevPos = useRef<Map<string, { x: number; z: number }>>(new Map())
  const lastDir = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const load = async () => {
      if (!gtfsParser.hasData()) await gtfsParser.loadFromStorageAsync()
      setVisibility(await delayManager.loadTripVisibilitySettings())
      setReady(true)
    }
    load()
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      setNow(nowMinutesLocal())
      setUpdatedAt(clockNow())
      setTick((t) => t + 1)
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  // 図をビューポートに合わせる（スクロールなしで全体が入る倍率を基準にする）
  const measure = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const w = el.clientWidth
    const h = el.clientHeight
    if (w > 0 && h > 0) setFit(Math.min(1, w / MAP_VIEWBOX.width, h / MAP_VIEWBOX.height))
  }, [])
  // ready前は読み込み表示でrefが無いため、描画後(ready)と全画面切替のたびに測り直す
  useEffect(() => {
    measure()
    const el = viewportRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, ready, expanded])

  // 全画面表示はEscで終了
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [expanded])

  const stat = useMemo(() => {
    if (!ready) return null
    const stopNameById = new Map<string, string>()
    const stopIdByName = new Map<string, string>()
    for (const s of gtfsParser.getStops()) {
      if (!stopNameById.has(s.stop_id)) stopNameById.set(s.stop_id, s.stop_name)
      if (!stopIdByName.has(s.stop_name)) stopIdByName.set(s.stop_name, s.stop_id)
    }
    const trips = gtfsParser.getTrips()
    const stopTimes = gtfsParser.getAllStopTimes()
    const routes = gtfsParser.getRoutes()
    // Dynmap実位置を時刻表に対応づける（運用番号の突き合わせ・遅延推定）ための便一覧
    const { schedule, trainOperationIds } = buildOperationSchedule({ trips, stopTimes, routes, stopNameById })
    return { trips, stopTimes, routes, stopNameById, stopIdByName, operationSchedule: schedule, trainOperationIds }
  }, [ready])

  // Dynmap実位置の取得（source=dynmap のとき。tick で定期更新）
  useEffect(() => {
    if (source !== "dynmap") return
    let cancelled = false
    const run = async () => {
      try {
        const [loadedCoords, res] = await Promise.all([
          stationCoordinateManager.load(),
          fetch("/api/rtm-trains").then((r) => r.json()).catch(() => null),
        ])
        if (cancelled) return
        if (!res || !res.success) {
          setRtmError("Dynmapマーカーの取得に失敗しました")
          setRtmStates([])
          setRtmUnmapped([])
          return
        }
        setRtmError(null)
        setCoords(loadedCoords)
        // バスは対象外（列車のみ）。locateRtmMarkers がバスを切り分ける。
        const { states, unmapped } = locateRtmMarkers({
          markers: (res.trains as RtmMarker[]) || [],
          coords: loadedCoords,
          prevPos: prevPos.current,
          lastDir: lastDir.current,
        })
        setRtmStates(states)
        setRtmUnmapped(unmapped)
      } catch {
        if (!cancelled) setRtmError("Dynmapマーカーの取得に失敗しました")
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [source, tick])

  const runStates = useMemo<TrainRunState[]>(() => {
    if (!stat) return []
    void tick
    return computeTrainRunStates({
      trips: stat.trips,
      stopTimes: stat.stopTimes,
      routes: stat.routes,
      stopNameById: stat.stopNameById,
      delaysByTripId: new Map<string, TrainDelay>(),
      visibilityByTripId: visibility,
      nowMinutes: now,
    }).filter((s) => s.routeType !== 3) // バスは対象外（列車のみ）
  }, [stat, visibility, now, tick])

  // Dynmap実位置を時刻表に対応づけて種別・行先・遅延・運用番号を解決する（/live と同じロジック）
  const rtmStatesResolved = useMemo<TrainRunState[]>(() => {
    if (!stat) return rtmStates
    return resolveRtmStatesWithSchedule({
      states: rtmStates,
      operationSchedule: stat.operationSchedule,
      trainOperationIds: stat.trainOperationIds,
      scheduleStates: runStates,
      coords,
      positionById: prevPos.current,
      nowMinutes: now,
    })
  }, [rtmStates, stat, runStates, coords, now])

  const shownStates = source === "dynmap" ? rtmStatesResolved : runStates

  // 図上の配置。同じ位置に複数の列車がいる場合は線に垂直な向きへずらして重なりを避ける。
  const placed = useMemo<Placed[]>(() => {
    const out: Placed[] = []
    for (const s of shownStates) {
      const pos = placeOnMap({
        atStation: s.atStation,
        fromStop: s.fromStop,
        toStop: s.toStop,
        progress: s.progress,
        nextStop: s.nextStop,
      })
      if (!pos) continue
      const lineName = lineOfState(s) || MAP_LINES[0].name
      // 近接する列車（対向列車も同じ側に出る）は、まず進行方向の後ろへ、次に外側へずらして重なりを避ける。
      // 線から離れすぎないよう、後ろ方向を優先して候補を試す。
      let cx = pos.x + pos.normalX * ICON_OFFSET
      let cy = pos.y + pos.normalY * ICON_OFFSET
      for (let k = 0; k < 9; k++) {
        const normal = ICON_OFFSET + STACK_STEP * Math.floor(k / 3)
        const back = -STACK_STEP * (k % 3)
        cx = pos.x + pos.normalX * normal + pos.dirX * back
        cy = pos.y + pos.normalY * normal + pos.dirY * back
        const hit = out.some((o) => Math.abs(o.cx - cx) < STACK_STEP && Math.abs(o.cy - cy) < STACK_STEP)
        if (!hit) break
      }
      out.push({ state: s, pos, lineName, color: mapLineColor(lineName), cx, cy })
    }
    return out
  }, [shownStates])

  // 線区ごとの在線本数と遅延（サイドバーの路線一覧）
  const lineStatus = useMemo(() => {
    return MAP_LINES.map((l) => {
      const trains = placed.filter((p) => p.lineName === l.name)
      const maxDelay = trains.reduce((m, p) => Math.max(m, p.state.delayMinutes), 0)
      return { name: l.name, color: mapLineColor(l.name), count: trains.length, maxDelay }
    })
  }, [placed])

  const scale = fit * zoom
  const width = MAP_VIEWBOX.width * scale
  const height = MAP_VIEWBOX.height * scale

  const timetableHref = (name: string) => {
    const id = stat?.stopIdByName.get(name)
    return id ? `/timetable/${encodeURIComponent(id)}` : null
  }

  if (!ready) {
    return <p className="py-12 text-center text-muted-foreground">ダイヤを読み込み中...</p>
  }

  return (
    // 全画面表示のときは画面いっぱいに広げる（管理画面のコンテナ幅に縛られない）
    <div
      className={
        expanded ? "fixed inset-0 z-50 flex flex-col gap-3 overflow-auto bg-background p-4" : "space-y-4"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <Train className="h-6 w-6" />
            列車運行状況マップ
          </h2>
          <p className="text-sm text-muted-foreground">
            路線図上に列車の在線位置を表示します（{REFRESH_MS / 1000}秒ごとに自動更新）。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* 表示元の切替（/live と同じ） */}
          <div className="flex overflow-hidden rounded-md border border-border text-sm">
            <button
              type="button"
              onClick={() => setSource("schedule")}
              className={`px-2.5 py-1.5 ${source === "schedule" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              ダイヤ予測
            </button>
            <button
              type="button"
              onClick={() => setSource("dynmap")}
              className={`border-l border-border px-2.5 py-1.5 ${source === "dynmap" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              Dynmap実位置
            </button>
          </div>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${rtmError ? "bg-red-600" : "bg-green-600"}`} />
            最終更新 {updatedAt} / 在線 {placed.length} 本
          </span>
          <button
            type="button"
            onClick={() => setShowSidebar((v) => !v)}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-muted"
          >
            <List className="h-4 w-4" />
            路線一覧
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-muted"
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            {expanded ? "全画面を終了" : "全画面"}
          </button>
        </div>
      </div>

      {source === "dynmap" && rtmError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{rtmError}</p>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        {showSidebar && (
          <div className="w-full space-y-3 lg:w-56 lg:flex-shrink-0">
            <div className="rounded-lg border border-border bg-card p-3">
              <h3 className="mb-2 text-sm font-bold">路線一覧</h3>
              <ul className="space-y-2">
                {lineStatus.map((l) => (
                  <li key={l.name} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-1.5 w-6 flex-shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
                      <span className="truncate text-sm">{l.name}</span>
                    </span>
                    <span
                      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        l.maxDelay > 0 ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"
                      }`}
                    >
                      {l.maxDelay > 0 ? `遅延 +${l.maxDelay}分` : "平常運転"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-border bg-card p-3 text-sm">
              <h3 className="mb-2 text-sm font-bold">凡例</h3>
              <ul className="space-y-1.5 text-muted-foreground">
                <li className="flex items-center gap-2">
                  <svg width="34" height="20" viewBox="0 0 34 20">
                    <rect x="1" y="2" width="16" height="16" rx="4" fill="#2563eb" />
                    <rect x="5" y="6" width="8" height="5" rx="1" fill="#fff" />
                    <polygon points="22,10 30,5.5 30,14.5" fill="#334155" />
                  </svg>
                  列車（進行方向）
                </li>
                <li className="flex items-center gap-2">
                  <svg width="34" height="20" viewBox="0 0 34 20">
                    <circle cx="9" cy="10" r="6" fill="#fff" stroke="#1f2937" strokeWidth="3" />
                  </svg>
                  駅
                </li>
                <li className="flex items-center gap-2">
                  <svg width="34" height="20" viewBox="0 0 34 20">
                    <rect x="1" y="2" width="16" height="16" rx="4" fill="#2563eb" stroke="#dc2626" strokeWidth="2.5" />
                  </svg>
                  遅延あり
                </li>
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                列車は駅名と反対側にずらして表示します。アイコンをクリックすると運用の詳細が出ます。
              </p>
            </div>

            {/* Dynmap実位置で線区に対応づかない列車（駅座標未登録・線路外） */}
            {source === "dynmap" && rtmUnmapped.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-3">
                <h3 className="mb-1 text-sm font-bold">線区に対応づかない列車（{rtmUnmapped.length}）</h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  駅座標が未登録、または線区から離れた位置の列車です。
                </p>
                <ul className="space-y-1 text-xs">
                  {rtmUnmapped.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2">
                      <span className="font-medium">{t.runNo || "(運用なし)"}</span>
                      <span className="truncate text-muted-foreground">{t.dest}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="relative min-w-0 flex-1">
          {/* 路線図は色を固定するため、ダークテーマでも明色キャンバスで描く */}
          <div
            ref={viewportRef}
            className="overflow-auto rounded-lg border border-border bg-white"
            // 画面の高さいっぱいまで使う（全画面時はさらに広げる）
            style={{ height: expanded ? "calc(100vh - 150px)" : "min(78vh, calc(100vh - 260px))", minHeight: 420 }}
          >
            <svg width={width} height={height} viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}>
              {/* 線区 */}
              {MAP_LINES.map((l) => (
                <path
                  key={l.name}
                  d={linePath(l)}
                  fill="none"
                  stroke={mapLineColor(l.name)}
                  strokeWidth={11}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}

              {/* 駅（丸＋駅名） */}
              {MAP_STATIONS.map((s) => {
                const href = timetableHref(s.name)
                const junction = linesAtStation(s.name).length > 1
                const gap = 20
                const tx = s.x + (s.side === "left" ? -gap : s.side === "right" ? gap : 0) + (s.dx || 0)
                const ty = s.y + (s.side === "top" ? -gap : s.side === "bottom" ? gap : 0) + (s.dy || 0)
                const anchor = s.side === "left" ? "end" : s.side === "right" ? "start" : "middle"
                const baseline = s.side === "top" ? "auto" : s.side === "bottom" ? "hanging" : "central"
                const label = (
                  <text
                    x={tx}
                    y={ty}
                    textAnchor={anchor}
                    dominantBaseline={baseline}
                    fontSize={15}
                    fontWeight={700}
                    fill="#1f2937"
                    stroke="#ffffff"
                    strokeWidth={4}
                    paintOrder="stroke"
                    className={href ? "cursor-pointer" : undefined}
                  >
                    {s.name}
                  </text>
                )
                return (
                  <g key={s.name}>
                    <circle
                      cx={s.x}
                      cy={s.y}
                      r={junction ? 10 : 9}
                      fill="#ffffff"
                      stroke="#1f2937"
                      strokeWidth={junction ? 4 : 3}
                    />
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        <title>{s.name} の時刻表を開く</title>
                        {label}
                      </a>
                    ) : (
                      label
                    )}
                  </g>
                )
              })}

              {/* 列車 */}
              {placed.map((p) => {
                const { pos, state: t, cx, cy } = p
                const angle = (Math.atan2(pos.dirY, pos.dirX) * 180) / Math.PI
                const delayed = t.delayMinutes > 0 // 早着は扱わない
                const isSel = selected?.operationId === t.operationId && selected?.tripId === t.tripId
                return (
                  <g
                    key={`${t.tripId}-${t.operationId}`}
                    className="cursor-pointer"
                    onClick={() => setSelected(t)}
                    transform={`translate(${cx},${cy})`}
                  >
                    <title>{`${t.operationId} ${t.routeName}${t.headsign ? " " + t.headsign : ""} / ${
                      t.atStation ? `${t.fromStop} 停車中` : `${t.fromStop}→${t.toStop} 走行中`
                    }`}</title>
                    {/* 線とアイコンをつなぐ引き出し線 */}
                    <line
                      x1={pos.x - cx}
                      y1={pos.y - cy}
                      x2={0}
                      y2={0}
                      stroke={p.color}
                      strokeWidth={2}
                      strokeDasharray="3 3"
                      opacity={0.6}
                    />
                    <rect
                      x={-15}
                      y={-15}
                      width={30}
                      height={30}
                      rx={8}
                      fill={p.color}
                      stroke={isSel ? "#111827" : delayed ? "#dc2626" : "#ffffff"}
                      strokeWidth={isSel ? 3.5 : delayed ? 3 : 2}
                    />
                    {/* 列車グリフ（窓＋足） */}
                    <rect x={-8} y={-9} width={16} height={9} rx={2} fill="#ffffff" />
                    <rect x={-8} y={2} width={5} height={5} rx={1} fill="#ffffff" />
                    <rect x={3} y={2} width={5} height={5} rx={1} fill="#ffffff" />
                    {/* 進行方向の矢印。終着駅に停車中（次駅なし）は向きが定まらないため出さない */}
                    {!(t.atStation && !t.nextStop) && (
                      <g transform={`rotate(${angle}) translate(24,0)`}>
                        <polygon points="0,-6 9,0 0,6" fill="#334155" />
                      </g>
                    )}
                    <text
                      y={28}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={700}
                      fill="#111827"
                      stroke="#ffffff"
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      {t.operationId}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>

          {/* 拡大・縮小 */}
          <div className="absolute bottom-3 left-3 flex overflow-hidden rounded-lg border border-border bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
              className="px-2.5 py-1.5 text-slate-700 hover:bg-slate-100"
              aria-label="拡大"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
              className="border-l border-border px-2.5 py-1.5 text-slate-700 hover:bg-slate-100"
              aria-label="縮小"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="border-l border-border px-2.5 py-1.5 text-slate-700 hover:bg-slate-100"
              aria-label="表示倍率を戻す"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>

          {placed.length === 0 && (
            <p className="mt-2 text-center text-sm text-muted-foreground">
              現在走行中の列車はありません（ダイヤの運転時間帯外の可能性があります）。
            </p>
          )}
        </div>
      </div>

      {/* 運用詳細（アイコンをクリックした列車） */}
      {selected && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold">
                運用 {selected.operationId}
                {selected.trainNumber ? ` / 列車番号 ${selected.trainNumber}` : ""}
              </p>
              <p className="text-sm text-muted-foreground">
                {selected.routeName}
                {selected.headsign ? ` ${selected.headsign}` : ""} ／{" "}
                {selected.atStation ? `${selected.fromStop} 停車中` : `${selected.fromStop}→${selected.toStop} 走行中`}
                {selected.delayMinutes > 0 ? ` ／ +${selected.delayMinutes}分` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              aria-label="閉じる"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {selected.upcoming && selected.upcoming.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {selected.upcoming.map((u) => (
                <span key={u.name}>
                  <span className="text-muted-foreground">{u.time}</span> {u.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
