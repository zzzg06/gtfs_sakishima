"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { gtfsParser } from "@/lib/gtfs-parser"
import { delayManager } from "@/lib/delay-manager"
import { computeTrainRunStates, type TrainRunState, type TrainDelay } from "@/lib/train-position"
import { RAIL_LINES } from "@/lib/rail-lines"
import {
  isDeadheadMarker,
  locateRtmMarkers,
  resolveRtmStatesWithSchedule,
  type RtmBusMarker,
  type RtmMarker,
} from "@/lib/rtm-locate"
import { stationCoordinateManager, type StationCoordinates } from "@/lib/station-coordinates"
import { buildApproachingBus, buildStrip, dedupeConsecutive, type ApproachingBus } from "@/lib/bus-locate"
import { vehicleManager } from "@/lib/vehicle-manager"
import { liveSettingsManager } from "@/lib/live-settings"
import { resolveDisplayVehicle } from "@/lib/dynmap-vehicle-icons"
import { busMapSettingsManager, type BusMapSettings } from "@/lib/bus-map"
import { buildOperationSchedule, type ScheduleLeg } from "@/lib/estimate-delay"
import {
  headsignMatchLevel,
  isBusOperationNumber,
  isExtraOperationNumber,
  isSameOperation,
  matchOperationByHeadsign,
  resolveOperationNumber,
} from "@/lib/operation-number"
import { abbrevSyubetsu, delayInfo, formatHeadsign, routeColor, vehicleIconUrl } from "@/lib/train-display"
import { TrainDetailModal } from "@/components/train-detail-modal"
import { StopMapPicker } from "@/components/stop-map-picker"
import { Train, Bus, RefreshCw, Map as MapIcon } from "lucide-react"

type RtmTrain = RtmMarker
type RtmBus = RtmBusMarker

// 便の運転時間帯と現在時刻の隔たり（分）。運転中なら0。4時間サイクルの繰り返しを考慮する。
function legTimeDistance(leg: ScheduleLeg, nowMinutes: number, offsetsHours = [0, 4, 8, 12]): number {
  const start = leg.depart[0]
  const end = leg.arrive[leg.arrive.length - 1]
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.POSITIVE_INFINITY
  let best = Number.POSITIVE_INFINITY
  for (const offH of offsetsHours) {
    const a = start + offH * 60
    const b = end + offH * 60
    const dist = nowMinutes < a ? a - nowMinutes : nowMinutes > b ? nowMinutes - b : 0
    if (dist < best) best = dist
  }
  return best
}

// 運用の複数便から、いま走っている便を選ぶ。
// (1)Dynmapの幕(行先)に一致する便を候補にする（完全一致・部分一致は同格に扱う）
// (2)候補のうち運転時間帯にある便を優先し、(3)完全一致>部分一致、(4)現在時刻に近い順。
// 幕に一致する便が1つも無ければ、運転時間帯・時刻の近さだけで選ぶ。
// ※「出入08 → 咲71」のように系統をまたぐ便があり、幕「咲島港駅ゆき」に対して
//   完全一致の咲71(運転時間帯外)より、部分一致でもいま走っている出入便を優先したい。
function pickBusLeg(legs: ScheduleLeg[], nowMinutes: number, dest: string): ScheduleLeg | null {
  const scored = legs
    .map((leg) => ({
      leg,
      dist: legTimeDistance(leg, nowMinutes),
      level: headsignMatchLevel(dest || "", leg.headsign) ?? 2, // 0=完全一致 1=部分一致 2=不一致
    }))
    .filter((c) => Number.isFinite(c.dist))
  if (scored.length === 0) return null
  const matched = scored.filter((c) => c.level <= 1)
  const pool = matched.length > 0 ? matched : scored
  pool.sort((a, b) => {
    const aRun = a.dist === 0
    const bRun = b.dist === 0
    if (aRun !== bRun) return aRun ? -1 : 1
    if (a.level !== b.level) return a.level - b.level
    return a.dist - b.dist
  })
  return pool[0].leg
}

// 線区間の接続（分岐）。指定駅に、別線区へ伸びる分岐線＋その線区へ飛ぶリンクを表示する。
// side: 分岐線を上方向(up)/下方向(down)どちらに描くか。
type LineConnection = { station: string; toLine: string; side: "up" | "down"; type: "curve" | "straight" }
const LINE_CONNECTIONS: Record<string, LineConnection[]> = {
  // 咲島線: 島北線へは横に曲がって分岐
  咲島線: [
    { station: "島北出坂", toLine: "島北線", side: "up", type: "curve" },
    { station: "中原台", toLine: "島北線", side: "down", type: "curve" },
  ],
  // 島北線: 終端から咲島線へまっすぐ上下に延長。大岩から御東方面へは横に曲がって分岐
  島北線: [
    { station: "島北出坂", toLine: "咲島線", side: "up", type: "straight" },
    { station: "大岩", toLine: "咲島線（御東方面）", side: "down", type: "curve" },
    { station: "中原台", toLine: "咲島線", side: "down", type: "straight" },
  ],
}

function lineColorOf(name: string): string {
  return routeColor(RAIL_LINES.find((l) => l.name === name)?.color || "")
}

// 列車走行位置（在線表示）。中央の縦線に対して 左=下り / 右=上り でアイコンを並べる。
// 1ページ1路線（セレクタ切替）。列車モードは物理路線(線区, lib/rail-lines)、バスモードは系統。
// 列車モードは複数種別を1線にまとめて表示。位置はダイヤ＋遅延から実時間で算出（Dynmap連携前）。

const REFRESH_MS = 10000
// 通過運転で在線区間とみなす線内スパンの上限（隣接=1）。環状の逆回り誤一致を避けるため。
const MAX_SPAN = 4

function nowMinutesLocal(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

interface SegPlacement {
  stops: string[]
  atDown: Map<number, TrainRunState[]>
  atUp: Map<number, TrainRunState[]>
  segDown: Map<number, TrainRunState[]>
  segUp: Map<number, TrainRunState[]>
}
interface BoardData {
  key: string
  name: string
  color: string
  segments: SegPlacement[]
  isBus: boolean
}

function placeInSegment(stops: string[], states: TrainRunState[]): SegPlacement {
  const idx = new Map<string, number>()
  stops.forEach((n, i) => {
    if (!idx.has(n)) idx.set(n, i)
  })
  const atDown = new Map<number, TrainRunState[]>()
  const atUp = new Map<number, TrainRunState[]>()
  const segDown = new Map<number, TrainRunState[]>()
  const segUp = new Map<number, TrainRunState[]>()
  const push = (m: Map<number, TrainRunState[]>, k: number, t: TrainRunState) => {
    const a = m.get(k)
    if (a) a.push(t)
    else m.set(k, [t])
  }
  // 上り/下り(左右の列・▲▼)は「この線区の駅並び順に対する実際の進行方向」で決める。
  // direction_id は循環運用だと線区ローカルの向きと逆になることがあり信頼できない
  // （例: 島北線は循環便の direction_id が駅順と逆向き）。判定不能時のみ direction_id にフォールバック。
  const localUp = (t: TrainRunState): boolean => {
    if (t.atStation) {
      const i = idx.get(t.fromStop)
      const n = t.nextStop != null ? idx.get(t.nextStop) : undefined
      if (i != null && n != null && n !== i) return n < i
      // 次駅がこの線区にない（分岐で線外へ向かう）場合、終端駅では「線内に入る向き＝上り」の逆＝下り側に出す。
      // 例: 島北線の終端 中原台に停車中で、島北線/御東方面(次駅=大岩)以外へ向かう列車は下りにする。
      if (i != null && i === stops.length - 1) return false
      return t.direction === 1
    }
    const a = idx.get(t.fromStop)
    const b = idx.get(t.toStop)
    if (a != null && b != null && a !== b) return b < a
    return t.direction === 1
  }
  for (const t of states) {
    const up = localUp(t)
    // 矢印(▲/▼)は t.direction を参照するため、列と矢印が食い違わないよう表示用 direction を進行方向へ揃える
    const tt: TrainRunState = (t.direction === 1) === up ? t : { ...t, direction: up ? 1 : 0 }
    if (t.atStation) {
      const i = idx.get(t.fromStop)
      if (i != null) push(up ? atUp : atDown, i, tt)
    } else {
      // from→to が線内にあれば在線区間とみなす（通過運転で駅を飛ばす場合も対応）。
      // ただし環状の逆回り等で両端が遠く離れる誤一致を避けるため、スパン上限(MAX_SPAN)を設ける。
      const a = idx.get(t.fromStop)
      const b = idx.get(t.toStop)
      if (a != null && b != null && a !== b && Math.abs(a - b) <= MAX_SPAN) {
        push(up ? segUp : segDown, Math.min(a, b), tt)
      }
    }
  }
  return { stops, atDown, atUp, segDown, segUp }
}

// 増結（途中駅で連結）対応: 同一位置・同一種別・同一行先・同一向きの列車を1本にまとめる。
// 連結後は時刻が完全一致するため在線位置も一致し、1ピンに統合される（連結前は位置が違うので別々のまま）。
function mergeCoupledStates(states: TrainRunState[]): TrainRunState[] {
  const groups = new Map<string, TrainRunState[]>()
  const singles: TrainRunState[] = []
  for (const s of states) {
    // 回送はまとめず、増結表記も出さない（同じ位置に並んでいても各車をそのまま出す）
    if (s.isDeadhead) {
      singles.push(s)
      continue
    }
    const key = [
      s.routeName,
      s.direction,
      s.atStation ? "S" : "R",
      s.fromStop,
      s.toStop,
      s.atStation ? "" : Math.round(s.progress * 100),
      s.headsign || "",
    ].join("|")
    const g = groups.get(key)
    if (g) g.push(s)
    else groups.set(key, [s])
  }
  const out: TrainRunState[] = [...singles]
  for (const g of groups.values()) {
    if (g.length === 1) {
      out.push(g[0])
      continue
    }
    // 列車番号順に並べ、先頭を基本・残りを併結相手として保持
    g.sort((a, b) => (a.trainNumber || a.operationId).localeCompare(b.trainNumber || b.operationId, undefined, { numeric: true }))
    out.push({ ...g[0], coupledWith: g.slice(1).map((s) => ({ operationId: s.operationId, trainNumber: s.trainNumber })) })
  }
  return out
}

// 列車の在線状態から、表示すべき線区とスクロール先の駅を求める（乗換案内→走行位置のフォーカス用）。
function findLineForState(t: TrainRunState): { name: string; station: string } | null {
  for (const line of RAIL_LINES) {
    for (const seg of line.segments) {
      if (t.atStation) {
        if (seg.includes(t.fromStop)) return { name: line.name, station: t.fromStop }
      } else {
        const a = seg.indexOf(t.fromStop)
        const b = seg.indexOf(t.toStop)
        if (a >= 0 && b >= 0 && Math.abs(a - b) <= MAX_SPAN) return { name: line.name, station: t.fromStop }
      }
    }
  }
  // フォールバック: 現在駅(fromStop)を含む最初の線区
  for (const line of RAIL_LINES) {
    for (const seg of line.segments) {
      if (seg.includes(t.fromStop)) return { name: line.name, station: t.fromStop }
    }
  }
  return null
}

export function TrainLocationBoard() {
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<"train" | "bus">("train")
  const [source, setSource] = useState<"schedule" | "dynmap">("schedule")
  const [selectedKey, setSelectedKey] = useState<string>("")
  const [now, setNow] = useState(nowMinutesLocal())
  const [tick, setTick] = useState(0)
  const [delays, setDelays] = useState<Map<string, TrainDelay>>(new Map())
  const [visibility, setVisibility] = useState<Record<string, boolean>>({})
  // Dynmap実位置
  const [rtmStates, setRtmStates] = useState<TrainRunState[]>([])
  const [rtmUnmapped, setRtmUnmapped] = useState<RtmTrain[]>([])
  const [rtmBuses, setRtmBuses] = useState<RtmBus[]>([])
  const [coords, setCoords] = useState<StationCoordinates>({})
  const [rtmError, setRtmError] = useState<string | null>(null)
  // バス: 検索または地図から選んだバス停
  const [selectedBusStop, setSelectedBusStop] = useState<string>("")
  const [busStopQuery, setBusStopQuery] = useState<string>("")
  const [showBusMap, setShowBusMap] = useState(false)
  const [busMapSettings, setBusMapSettings] = useState<BusMapSettings>({ imageUrl: "", refs: [] })
  // 運用詳細（ピンクリックで表示する列車）
  const [selectedTrain, setSelectedTrain] = useState<TrainRunState | null>(null)
  const prevPos = useRef<Map<string, { x: number; z: number }>>(new Map())
  const lastDir = useRef<Map<string, number>>(new Map())
  // 分岐リンクで線区を切替えた後、対象駅へスクロールするための保留先
  const pendingScrollRef = useRef<string | null>(null)
  // スクロール要求トークン。線区が変わらない（boardが同一）ときでもスクロールを発火させる
  const [scrollToken, setScrollToken] = useState(0)
  // 乗換案内から「走行位置」リンクで飛んできたときにフォーカスする運用番号
  const [focusOp, setFocusOp] = useState<string | null>(null)
  // 表示元(管理者設定)の読み込みが済んだか。読み込み前にフォーカスを解決しないためのゲート
  const [sourceReady, setSourceReady] = useState(false)

  useEffect(() => {
    const load = async () => {
      if (!gtfsParser.hasData()) await gtfsParser.loadFromStorageAsync()
      // 遅延の手入力は廃止。運休(visibility)と車両割当のみ読み込む。
      // 表示元(ダイヤ予測/Dynmap実位置)は管理者設定に従う（利用者は切り替えられない）。
      const [vis, live] = await Promise.all([
        delayManager.loadTripVisibilitySettings(),
        liveSettingsManager.load(),
        vehicleManager.loadCache(),
      ])
      setVisibility(vis)
      setSource(live.positionSource)
      setSourceReady(true)
      setReady(true)
      // バス停の地図ピッカーで使うため、表示元に関わらず座標と地図設定を読み込んでおく
      stationCoordinateManager
        .load()
        .then((c) => setCoords((prev) => (Object.keys(prev).length > 0 ? prev : c)))
        .catch(() => {})
      busMapSettingsManager.load().then(setBusMapSettings).catch(() => {})
    }
    load()
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      setNow(nowMinutesLocal())
      setTick((t) => t + 1)
      // 車両割当・表示元設定の変更に追従（モジュールキャッシュ更新→次レンダーで反映）
      vehicleManager.loadCache().catch(() => {})
      liveSettingsManager
        .load()
        .then((s) => setSource(s.positionSource))
        .catch(() => {})
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  // 乗換案内の「走行位置」リンク（/live?focus=運用番号）で飛んできたら、その運用にフォーカスする
  useEffect(() => {
    const op = new URLSearchParams(window.location.search).get("focus")
    if (op) {
      setMode("train")
      setFocusOp(op)
    }
  }, [])

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
          setRtmBuses([])
          return
        }
        setRtmError(null)
        setCoords(loadedCoords)
        const { states, unmapped, buses } = locateRtmMarkers({
          markers: (res.trains as RtmTrain[]) || [],
          coords: loadedCoords,
          prevPos: prevPos.current,
          lastDir: lastDir.current,
        })
        setRtmStates(states)
        setRtmUnmapped(unmapped)
        setRtmBuses(buses)
      } catch {
        if (!cancelled) setRtmError("Dynmapマーカーの取得に失敗しました")
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [source, tick])

  const stat = useMemo(() => {
    if (!ready) return null
    const trips = gtfsParser.getTrips()
    // 通過駅込み（在線表示の駅飛ばし対応・遅延推定の区間照合のため）
    const stopTimes = gtfsParser.getAllStopTimes()
    const routes = gtfsParser.getRoutes()
    const stopNameById = new Map<string, string>()
    for (const s of gtfsParser.getStops()) if (!stopNameById.has(s.stop_id)) stopNameById.set(s.stop_id, s.stop_name)
    const routeColorById = new Map<string, string>()
    for (const r of routes) routeColorById.set(r.route_id, routeColor(r.route_color))

    const byTrip = new Map<string, typeof stopTimes>()
    for (const st of stopTimes) {
      const a = byTrip.get(st.trip_id)
      if (a) a.push(st)
      else byTrip.set(st.trip_id, [st])
    }
    for (const a of byTrip.values()) a.sort((x, y) => x.stop_sequence - y.stop_sequence)
    const repByRoute = new Map<string, string[]>()
    const tripStops = new Map<string, string[]>() // trip_id → 停車順(駅名・連続重複除去)
    for (const t of trips) {
      const seq = byTrip.get(t.trip_id)
      if (!seq) continue
      const names: string[] = []
      for (const st of seq) {
        const n = stopNameById.get(st.stop_id) || st.stop_id
        if (names[names.length - 1] !== n) names.push(n)
      }
      tripStops.set(t.trip_id, names)
      const cur = repByRoute.get(t.route_id)
      if (!cur || names.length > cur.length) repByRoute.set(t.route_id, names)
    }
    const busRoutes = routes
      .filter((r) => r.route_type === 3 && repByRoute.has(r.route_id))
      .sort((a, b) => (repByRoute.get(b.route_id)?.length || 0) - (repByRoute.get(a.route_id)?.length || 0))

    // 系統名(route_short_name)→route_id（Dynmapのライブバス系統を解決するため）
    const busRouteBySystem = new Map<string, string>()
    for (const r of busRoutes) {
      const sys = r.route_short_name || r.route_long_name || ""
      if (sys && !busRouteBySystem.has(sys)) busRouteBySystem.set(sys, r.route_id)
    }
    // バス停一覧（名称＋読み）。バス系統の代表停車順に現れる停の和集合。
    const readingById = new Map<string, string>()
    for (const s of gtfsParser.getStops()) if (s.stop_desc) readingById.set(s.stop_id, s.stop_desc)
    const busStopSet = new Set<string>()
    for (const r of busRoutes) for (const n of repByRoute.get(r.route_id) || []) busStopSet.add(n)
    const busStops = [...busStopSet]
      .map((name) => ({ name, reading: readingById.get(name) || "" }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"))

    // 運用番号(trip_short_name)→便の停車順＋発着分。Dynmap遅延推定・運用突き合わせに使う。
    const {
      schedule: operationSchedule,
      busOperationIds,
      trainOperationIds,
    } = buildOperationSchedule({ trips, stopTimes, routes, stopNameById })

    return {
      trips,
      stopTimes,
      routes,
      stopNameById,
      routeColorById,
      repByRoute,
      tripStops,
      busRoutes,
      busRouteBySystem,
      busStops,
      operationSchedule,
      busOperationIds,
      trainOperationIds,
    }
  }, [ready])

  const runStates = useMemo<TrainRunState[]>(() => {
    if (!stat) return []
    void tick
    return computeTrainRunStates({
      trips: stat.trips,
      stopTimes: stat.stopTimes,
      routes: stat.routes,
      stopNameById: stat.stopNameById,
      delaysByTripId: delays,
      visibilityByTripId: visibility,
      nowMinutes: now,
    })
  }, [stat, delays, visibility, now, tick])

  // Dynmap実位置の列車を時刻表に対応づけ、運用番号が一致すれば 種別・行先・進行方向・遅延 を
  // ダイヤ予測と同様に解決して上書きする（折り返しは時刻で判別。手入力遅延の代替）。
  const rtmStatesWithDelay = useMemo<TrainRunState[]>(() => {
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
  }, [rtmStates, stat, now, runStates, coords])

  // フォーカス対象の運用が現在走行中なら、その列車の線区へ切替＋スクロールし、運用詳細を開く。
  // 表示元(source)確定後、該当状態が算出できた時点で一度だけ実行する。
  useEffect(() => {
    if (!focusOp || !stat || !sourceReady) return // 表示元(管理者設定)の読み込み後に解決
    const states = source === "dynmap" ? rtmStatesWithDelay : runStates
    const target =
      states.find((s) => isSameOperation(s.operationId, focusOp)) ||
      runStates.find((s) => isSameOperation(s.operationId, focusOp))
    if (!target) return // まだ算出途中（dynmap取得待ち等）。再レンダーで再試行
    const line = findLineForState(target)
    if (line) {
      pendingScrollRef.current = line.station
      setSelectedKey(line.name)
      setScrollToken((t) => t + 1) // 既定線区と同じでもスクロールを発火させる
    }
    setSelectedTrain(target)
    setFocusOp(null) // 一度きり
  }, [focusOp, sourceReady, source, runStates, rtmStatesWithDelay, stat])

  // 路線セレクタの選択肢（列車モードの線区。バスはバス停検索ビューのため使わない）
  const options = useMemo(() => {
    if (!stat) return [] as { key: string; name: string; color: string }[]
    return RAIL_LINES.map((l) => ({ key: l.name, name: l.name, color: routeColor(l.color) }))
  }, [stat])

  // モード変更時・初期は先頭を選択
  useEffect(() => {
    if (options.length > 0 && !options.some((o) => o.key === selectedKey)) setSelectedKey(options[0].key)
  }, [options, selectedKey])

  const board = useMemo<BoardData | null>(() => {
    if (!stat || !selectedKey) return null
    if (mode === "bus") return null // バスはバス停選択ビュー（鉄道盤は出さない）
    const line = RAIL_LINES.find((l) => l.name === selectedKey)
    if (!line) return null
    const states = mergeCoupledStates(
      // バス運用(B0x/バスN)は列車走行位置には出さない（暫定処置）
      (source === "dynmap" ? rtmStatesWithDelay : runStates.filter((t) => t.routeType !== 3)).filter(
        (t) => !isBusOperationNumber(t.operationId),
      ),
    )
    return {
      key: line.name,
      name: line.name,
      color: routeColor(line.color),
      isBus: false,
      segments: line.segments.map((s) => placeInSegment(s, states)),
    }
  }, [stat, selectedKey, mode, source, runStates, rtmStatesWithDelay])

  // 分岐リンク: 対象線区へ切替えつつ、共有駅へスクロールする保留をセット
  const goToBranch = (conn: LineConnection) => {
    pendingScrollRef.current = conn.station
    setSelectedKey(conn.toLine)
    setScrollToken((t) => t + 1)
  }

  // 線区切替(board更新)後、保留があれば対象駅へスクロール。
  // 先頭駅=ページ最上部 / 末尾駅=最下部 / それ以外=該当駅を画面中央へ。
  useEffect(() => {
    const target = pendingScrollRef.current
    if (!target || !board) return
    pendingScrollRef.current = null
    const stops = board.segments.flatMap((s) => s.stops)
    const idx = stops.indexOf(target)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (idx === 0) {
          window.scrollTo({ top: 0, behavior: "smooth" })
        } else if (idx === stops.length - 1) {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })
        } else {
          const el = Array.from(document.querySelectorAll<HTMLElement>("[data-station-name]")).find(
            (e) => e.dataset.stationName === target,
          )
          el?.scrollIntoView({ block: "center", behavior: "smooth" })
        }
      }),
    )
  }, [board, scrollToken])

  // 地図ピッカー用の系統（代表停車順＋系統色）
  const busMapRoutes = useMemo(() => {
    if (!stat) return []
    return stat.busRoutes.map((r) => ({
      name: r.route_short_name || r.route_long_name || r.route_id,
      color: stat.routeColorById.get(r.route_id) || "#0891b2",
      stops: stat.repByRoute.get(r.route_id) || [],
    }))
  }, [stat])

  // バス: 選択したバス停に接近中のバス（手前数停＋現在位置）。
  // Dynmap実位置はライブ座標から、ダイヤ予測は時刻表(runStates)から現在位置を求める。
  const busView = useMemo(() => {
    const empty = { approaching: [] as ApproachingBus[], unlocated: [] as RtmBus[] }
    if (!stat || mode !== "bus" || !selectedBusStop) return empty
    const approaching: ApproachingBus[] = []
    const unlocated: RtmBus[] = []
    if (source === "dynmap") {
      for (const bus of rtmBuses) {
        if (isDeadheadMarker(bus)) continue // 回送は営業便ではないので接近案内に出さない
        // B99 は臨時便。運用の突き合わせ（停車順の特定）はそのまま行うが、
        // 表示する系統・行先はダイヤではなくDynmapの表示を優先し、「臨時」として出す。
        const isExtraBus = isExtraOperationNumber(bus.runNo || "")
        // 運用の特定:
        // (1)運用番号(B0x)の数字一致。その運用の便が幕(行先)と噛み合えばそれを採用
        // (2)噛み合わない（ダイヤと違う運用に入っている等）ときは、幕と一致する運行中の運用へ
        // (3)どちらも決まらなければ番号が最も近い運用
        // 便は「幕と一致する便 → 運転時間帯にある便 → 時刻が近い便」の順で選ぶ（pickBusLeg）。
        const pickLegOf = (op?: string | null) => {
          const legs = op ? stat.operationSchedule[op] : undefined
          return legs && legs.length > 0 ? pickBusLeg(legs, now, bus.dest || "") : null
        }
        let opId: string | null = resolveOperationNumber(bus.runNo || "", stat.busOperationIds)
        let leg = pickLegOf(opId)
        if (!leg || headsignMatchLevel(bus.dest || "", leg.headsign) === null) {
          const destOp = matchOperationByHeadsign(bus.dest, true, runStates, coords, bus)
          const destLeg = pickLegOf(destOp)
          if (destOp && destLeg) {
            opId = destOp
            leg = destLeg
          } else {
            // 運行中の運用に該当が無ければ、全バス運用の便から幕(行先)が一致する便を探す。
            // ダイヤ上の時間帯とずれて走っていても、行先が示す系統の停車順で測位できるようにする。
            let best: { op: string; leg: ScheduleLeg; level: number; dist: number } | null = null
            for (const op of stat.busOperationIds) {
              for (const l of stat.operationSchedule[op] || []) {
                const level = headsignMatchLevel(bus.dest || "", l.headsign)
                if (level === null) continue
                const dist = legTimeDistance(l, now)
                if (!best || level < best.level || (level === best.level && dist < best.dist)) {
                  best = { op, leg: l, level, dist }
                }
              }
            }
            if (best) {
              opId = best.op
              leg = best.leg
            }
          }
        }
        if (!opId) {
          opId = resolveOperationNumber(bus.runNo || "", stat.busOperationIds, { nearest: true })
          leg = pickLegOf(opId)
        }
        let seq = leg ? leg.stops : undefined
        if (!seq) {
          // 運用が突き合わせできない場合は従来どおり系統ラベル(マーカーの種別)の代表停車順を使う
          const routeId = stat.busRouteBySystem.get(bus.type)
          seq = routeId ? stat.repByRoute.get(routeId) : undefined
        }
        if (!seq || !seq.includes(selectedBusStop)) continue // この便は選択停に停まらない
        const r = buildApproachingBus({
          id: bus.id,
          line: (isExtraBus ? bus.type || leg?.routeName : leg?.routeName || bus.type) || "",
          dest: formatHeadsign(
            (isExtraBus ? bus.dest || leg?.headsign : leg?.headsign || bus.dest) || "",
            bus.destNote,
          ),
          x: bus.x,
          z: bus.z,
          seq: dedupeConsecutive(seq),
          coords,
          prev: bus.prev,
          selectedStop: selectedBusStop,
          lookBack: 4,
        })
        if (r.kind === "approaching") approaching.push(isExtraBus ? { ...r.bus, isExtra: true } : r.bus)
        // 位置不明でも、突き合わせた便の系統・行先が分かっていればそれを見せる
        else if (r.kind === "unlocated")
          unlocated.push(
            isExtraBus
              ? bus
              : { ...bus, type: leg?.routeName || bus.type, dest: leg?.headsign || bus.dest },
          )
        // not-approaching（通過済み等）は表示しない
      }
    } else {
      // ダイヤ予測: 現在運行中のバス便(runStates)から、選択停を前方に控える便を組み立てる
      for (const rs of runStates) {
        if (rs.routeType !== 3) continue
        const seq = stat.tripStops.get(rs.tripId)
        if (!seq || !seq.includes(selectedBusStop)) continue
        // 現在位置(停index): 在線中はその停、走行中は from→to の区間に一致する出現を採用（環状の重複対策）
        let cIdx = -1
        for (let i = 0; i < seq.length; i++) {
          if (seq[i] !== rs.fromStop) continue
          if (rs.atStation || (i < seq.length - 1 && seq[i + 1] === rs.toStop)) {
            cIdx = i
            break
          }
        }
        if (cIdx < 0) cIdx = seq.indexOf(rs.fromStop)
        if (cIdx < 0) continue
        // 選択停は現在位置以降(前方)にある最初の出現
        let sIdx = -1
        for (let i = cIdx; i < seq.length; i++) {
          if (seq[i] === selectedBusStop) {
            sIdx = i
            break
          }
        }
        if (sIdx < 0) continue // 通過済み＝これから停車しない
        const { strip, beyondWindow } = buildStrip(seq, cIdx, sIdx, true, 4)
        const d = delayInfo(rs.status, rs.delayMinutes)
        approaching.push({
          id: `${rs.tripId}-${rs.operationId}`,
          line: rs.routeName || rs.operationId,
          dest: rs.headsign || "",
          stopsAway: sIdx - cIdx,
          beyondWindow,
          strip,
          delayed: d.delayed,
          delayText: d.text,
        })
      }
    }
    approaching.sort((a, b) => a.stopsAway - b.stopsAway)
    return { approaching, unlocated }
  }, [stat, source, mode, selectedBusStop, rtmBuses, coords, runStates])

  if (!ready || !stat) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin" />
        読み込み中...
      </div>
    )
  }

  const hh = Math.floor(now / 60)
  const mm = Math.floor(now % 60)
  const isBusStopView = mode === "bus" // バスはソース問わずバス停選択ビュー
  const isDynBus = source === "dynmap" && mode === "bus"
  const totalInSource =
    source === "dynmap"
      ? isDynBus
        ? rtmBuses.length
        : rtmStates.length
      : runStates.filter((t) => (mode === "bus" ? t.routeType === 3 : t.routeType !== 3)).length

  // 1列車（車両カード＝画像＋種別。行先はホバー時のみ吹き出し表示。矢印は上り=上/下り=下。遅延はカード外の下）
  const Pin = ({ t }: { t: TrainRunState }) => {
    const color = stat.routeColorById.get(t.routeId) || "#0891b2"
    const d = delayInfo(t.status, t.delayMinutes)
    // 車両アイコン: Dynmapのマーカーアイコンで形式が分かればその車両、分からなければ運用に割り当てた車両。
    // どちらも無ければ既定(列車2900.png/バスbus.png)。
    const vehicle = resolveDisplayVehicle(t.dynmapIcon, vehicleManager.getCachedVehicleForOperation(t.operationId))
    const img = vehicle?.iconUrl || (t.routeType === 3 ? "/vehicles/bus.png" : "/vehicles/2900.png")
    const coupled = (t.coupledWith?.length || 0) > 0
    const allTrainNos = [t.trainNumber, ...(t.coupledWith?.map((c) => c.trainNumber) || [])].filter(Boolean)
    const up = t.direction === 1
    const arrow = (
      <span className="text-sm leading-none" style={{ color: d.color }}>
        {up ? "▲" : "▼"}
      </span>
    )
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={() => setSelectedTrain(t)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setSelectedTrain(t)
          }
        }}
        className="group pointer-events-auto relative z-10 inline-flex flex-shrink-0 cursor-pointer flex-col items-center gap-0.5"
        title={`${t.isExtra ? "[臨時] " : ""}${t.routeName} 運用${t.operationId}${
          t.headsign ? " " + formatHeadsign(t.headsign, t.headsignNote) : ""
        }${
          coupled ? `\n増結: 列車番号 ${allTrainNos.join(" + ")}` : ""
        }\n${
          t.atStation ? `${t.fromStop} 停車中` : `${t.fromStop}→${t.toStop} 走行中`
        } / ${d.text}`}
      >
        {/* 車両カード（大枠）。既定は画像＋種別のみで小型化 */}
        <span
          className="relative inline-flex flex-col items-center gap-0.5 rounded-lg border bg-white px-1.5 py-1 text-center shadow-sm"
          style={{ borderColor: color, outline: d.delayed ? `2px solid ${d.color}` : "none" }}
        >
          {/* 臨時列車（ダイヤ外。Dynmapで設定された種別・行先をそのまま表示している） */}
          {t.isExtra && (
            <span className="absolute -left-1.5 -top-1.5 z-30 rounded-full border border-white bg-rose-600 px-1 text-[9px] font-bold leading-tight text-white shadow">
              臨時
            </span>
          )}
          {/* 増結（途中駅で連結した併結列車）。1ピンにまとめて表示中であることを示す */}
          {coupled && (
            <span className="absolute -right-1.5 -top-1.5 z-30 rounded-full border border-white bg-amber-500 px-1 text-[9px] font-bold leading-tight text-white shadow">
              増結
            </span>
          )}
          {/* 上り: 進行方向を画像の上に */}
          {up && arrow}
          {/* 車両画像（種別アイコンの代わり）。高さ固定・幅自動で列車/バスをそろえる */}
          <img
            src={img}
            alt={t.routeType === 3 ? "バス" : "列車"}
            draggable={false}
            className="h-12 w-auto flex-shrink-0 object-contain"
          />
          {/* 種別（路線色の別枠・白抜き文字） */}
          <span
            className="whitespace-nowrap rounded px-1 py-0.5 text-xs font-bold leading-none text-white"
            style={{ backgroundColor: color }}
          >
            {abbrevSyubetsu(t.routeName) || t.operationId}
          </span>
          {/* 下り: 進行方向を種別の下に */}
          {!up && arrow}
          {/* 行先: ホバー時のみ表示（絶対配置でレイアウト不変・上方に吹き出し） */}
          {t.headsign && (
            <span
              className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 -translate-x-1/2 whitespace-nowrap rounded border bg-white px-1.5 py-0.5 text-[11px] font-medium opacity-0 shadow-md transition-opacity group-hover:opacity-100"
              style={{ borderColor: color, color }}
            >
              {formatHeadsign(t.headsign, t.headsignNote)}
            </span>
          )}
        </span>
        {/* 遅延（大枠の外・下） */}
        {d.delayed && (
          <span className="whitespace-nowrap text-[10px] font-medium leading-none" style={{ color: d.color }}>
            {d.text}
          </span>
        )}
      </span>
    )
  }

  // Dynmap実位置のバス1台ぶん（系統・行先＋手前数停の停留所と現在位置）
  const BusApproachRow = ({ b }: { b: ApproachingBus }) => (
    <div className="rounded-lg border border-border p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        {/* 臨時便(B99)。ダイヤに無い便なのでDynmapの系統・行先をそのまま出している */}
        {b.isExtra && (
          <span className="whitespace-nowrap rounded bg-rose-600 px-1.5 py-0.5 text-xs font-bold text-white">臨時</span>
        )}
        <span className="rounded bg-green-700 px-2 py-1 text-base font-bold text-white">{b.line}</span>
        <span className="min-w-0 truncate text-lg font-bold">{b.dest}</span>
        {b.delayed && b.delayText && (
          <span className="whitespace-nowrap text-sm font-medium text-amber-600">{b.delayText}</span>
        )}
        <span className="ml-auto whitespace-nowrap text-base font-bold text-green-700">
          {b.stopsAway === 0 ? "まもなく" : `あと ${b.stopsAway} 停留所`}
        </span>
      </div>
      {/* 停留所は横一列（左=手前 → 右=選択停）。停留所名は縦書きにして列幅を細く保つ */}
      <div className="overflow-x-auto pb-1">
        <div className="flex items-start">
          {b.beyondWindow && (
            <div className="flex w-12 flex-shrink-0 flex-col items-center">
              <div className="h-12" />
              <div className="relative flex h-5 w-full items-center justify-center">
                <span className="absolute right-0 top-1/2 h-1.5 w-1/2 -translate-y-1/2 bg-green-700/40" />
                <span className="relative z-10 text-sm leading-none text-muted-foreground">⋯</span>
              </div>
              <div
                className="mt-1.5 whitespace-nowrap text-xs leading-tight text-muted-foreground"
                style={{ writingMode: "vertical-rl" }}
              >
                {b.stopsAway}停以上手前
              </div>
            </div>
          )}
          {b.strip.map((s, i) => (
            <div key={s.index} className="flex w-16 flex-shrink-0 flex-col items-center">
              {/* バス（現在位置）。高さ固定枠で全列のラインを水平にそろえる */}
              <div className="flex h-12 items-end justify-center">
                {s.current && <img src="/vehicles/bus.png" alt="バス" draggable={false} className="h-11 w-auto" />}
              </div>
              {/* 横線＋停留所の丸 */}
              <div className="relative flex h-5 w-full items-center justify-center">
                {(i > 0 || b.beyondWindow) && (
                  <span className="absolute left-0 top-1/2 h-1.5 w-1/2 -translate-y-1/2 bg-green-700/40" />
                )}
                {i < b.strip.length - 1 && (
                  <span className="absolute right-0 top-1/2 h-1.5 w-1/2 -translate-y-1/2 bg-green-700/40" />
                )}
                <span
                  className={`relative z-10 flex-shrink-0 rounded-full ${
                    s.isTarget ? "h-5 w-5 bg-green-700" : "h-3.5 w-3.5 border-[3px] border-muted-foreground/40 bg-background"
                  }`}
                />
              </div>
              {/* 停留所名（縦書き） */}
              <div
                className={`mt-1.5 whitespace-nowrap text-sm leading-tight ${
                  s.isTarget ? "font-bold text-green-700" : "text-foreground/80"
                }`}
                style={{ writingMode: "vertical-rl" }}
              >
                {s.name}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  const Segment = ({
    sp,
    color,
    connections = [],
  }: {
    sp: SegPlacement
    color: string
    connections?: LineConnection[]
  }) => (
    <div>
      {sp.stops.map((name, i) => {
        const isFirst = i === 0
        const isLast = i === sp.stops.length - 1
        const conn = connections.find((c) => c.station === name)
        const atD = sp.atDown.get(i) || []
        const atU = sp.atUp.get(i) || []
        const segD = i < sp.stops.length - 1 ? sp.segDown.get(i) || [] : []
        const segU = i < sp.stops.length - 1 ? sp.segUp.get(i) || [] : []
        return (
          <div key={`${name}-${i}`}>
            {/* 駅行（左=上り / 右=下り）。列車ピン(約92px)が上下の隣接行のピンと重ならないよう行を高く取る */}
            <div className="flex min-h-[98px] items-stretch">
              <div
                data-station-name={name}
                className="flex w-28 flex-shrink-0 items-center justify-end pr-2 text-right text-base font-bold"
              >
                {name}
              </div>
              {/* 上り側ゾーン: ピンは絶対配置のオーバーレイで上下中央。背の高いピンでも行の高さ(駅間隔)を変えない */}
              <div className="relative min-w-0 flex-1">
                <div className="pointer-events-none absolute inset-y-0 left-0 right-1 flex flex-wrap content-center items-center justify-end gap-1">
                  {atU.map((t, k) => (
                    <Pin key={k} t={t} />
                  ))}
                </div>
              </div>
              {/* 中央線(前面 z-10)：終着駅ではアイコンの外側に線を伸ばさない */}
              <div className="relative z-10 flex w-6 flex-shrink-0 justify-center">
                <span
                  className="absolute w-1.5"
                  style={{ backgroundColor: color, top: isFirst ? "50%" : 0, bottom: isLast ? "50%" : 0 }}
                />
                <span
                  className="absolute top-1/2 z-10 h-4 w-4 -translate-y-1/2 rounded-full border-[3px] bg-white"
                  style={{ borderColor: color }}
                />
                {/* 直線延長(島北線など終端から咲島線へ): ノードからまっすぐ上下に伸ばす */}
                {conn &&
                  conn.type === "straight" &&
                  (() => {
                    const c = lineColorOf(conn.toLine)
                    const up = conn.side === "up"
                    return (
                      <>
                        <span
                          className="absolute left-1/2 w-1.5 -translate-x-1/2"
                          style={{
                            backgroundColor: c,
                            height: "48px",
                            top: up ? "calc(50% - 48px)" : "50%",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => goToBranch(conn)}
                          className="pointer-events-auto absolute left-1/2 z-30 whitespace-nowrap rounded border bg-white px-2 py-0.5 text-xs font-bold transition-colors hover:bg-accent"
                          style={{
                            color: c,
                            borderColor: c,
                            top: up ? "calc(50% - 48px)" : "calc(50% + 48px)",
                            transform: up ? "translate(-50%, -100%)" : "translate(-50%, 100%)",
                          }}
                          title={`${conn.toLine}の走行位置へ`}
                        >
                          {up ? "▲" : "▼"} {conn.toLine} ▶
                        </button>
                      </>
                    )
                  })()}
              </div>
              {/* 下り側ゾーン（相対配置）。曲線分岐はこの中に背面(z-0)で描く */}
              <div className="relative min-w-0 flex-1">
                {/* 曲線分岐(咲島線→島北線): ノードから大きなRで曲がり、右端まで横に伸びる */}
                {conn &&
                  conn.type === "curve" &&
                  (() => {
                    const c = lineColorOf(conn.toLine)
                    const up = conn.side === "up"
                    const R = 34
                    return (
                      // 中央線(6px)中心に縦部分(6px)を重ねるため左に15px寄せる
                      <div className="pointer-events-none absolute z-0" style={{ top: 0, bottom: 0, left: -15, right: 0 }}>
                        {/* 角（縦→横の大きな丸み） */}
                        <div
                          className="absolute"
                          style={{
                            left: 0,
                            width: R,
                            height: R,
                            borderLeft: `6px solid ${c}`,
                            [up ? "borderTop" : "borderBottom"]: `6px solid ${c}`,
                            [up ? "borderTopLeftRadius" : "borderBottomLeftRadius"]: R,
                            top: up ? `calc(50% - ${R}px)` : "50%",
                          }}
                        />
                        {/* 横線（角から右端まで） */}
                        <div
                          className="absolute"
                          style={{
                            left: R,
                            right: 0,
                            height: 6,
                            backgroundColor: c,
                            // 角の外側ボーダー(6px)の中心線に合わせる: up は +3px、down は -3px
                            top: up ? `calc(50% - ${R}px + 3px)` : `calc(50% + ${R}px - 3px)`,
                            transform: "translateY(-50%)",
                          }}
                        />
                        {/* リンク（右端） */}
                        <button
                          type="button"
                          onClick={() => goToBranch(conn)}
                          className="pointer-events-auto absolute z-30 -translate-y-1/2 whitespace-nowrap rounded border bg-white px-2 py-0.5 text-xs font-bold transition-colors hover:bg-accent"
                          style={{
                            right: 0,
                            // 横線(角ボーダー中心線)に合わせる
                            top: up ? `calc(50% - ${R}px + 3px)` : `calc(50% + ${R}px - 3px)`,
                            color: c,
                            borderColor: c,
                          }}
                          title={`${conn.toLine}の走行位置へ`}
                        >
                          {up ? "↗" : "↘"} {conn.toLine} ▶
                        </button>
                      </div>
                    )
                  })()}
                <div className="pointer-events-none absolute inset-y-0 left-1 right-0 flex flex-wrap content-center items-center gap-1">
                  {atD.map((t, k) => (
                    <Pin key={k} t={t} />
                  ))}
                </div>
              </div>
            </div>
            {/* 駅間行（連続した1本の線）。左=上り / 右=下り */}
            {!isLast && (
              <div className="flex min-h-[92px] items-stretch">
                <div className="w-28 flex-shrink-0" />
                <div className="relative min-w-0 flex-1">
                  <div className="pointer-events-none absolute inset-y-0 left-0 right-1 flex flex-wrap content-center items-center justify-end gap-1">
                    {segU.map((t, k) => (
                      <Pin key={k} t={t} />
                    ))}
                  </div>
                </div>
                <div className="flex w-6 flex-shrink-0 justify-center">
                  <span className="w-1.5" style={{ backgroundColor: color }} />
                </div>
                <div className="relative min-w-0 flex-1">
                  <div className="pointer-events-none absolute inset-y-0 left-1 right-0 flex flex-wrap content-center items-center gap-1">
                    {segD.map((t, k) => (
                      <Pin key={k} t={t} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      {/* ヘッダー */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          {mode === "bus" && source === "schedule" ? (
            <Bus className="h-5 w-5 text-green-700" />
          ) : (
            <Train className="h-5 w-5 text-green-700" />
          )}
          <span className="text-lg font-bold">列車走行位置</span>
          <span className="text-sm tabular-nums text-muted-foreground">
            {String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")} 現在 / 在線 {totalInSource} 本
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* データ元は管理者設定（/admin の運行状況マップ）で切り替える。ここでは表示のみ。 */}
          <span className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">
            {source === "dynmap" ? "実位置表示" : "ダイヤ予測表示"}
          </span>
          {/* 列車/バス（Dynmap実位置はバス停検索ビューに切替） */}
          {(
            <div className="flex overflow-hidden rounded border border-border">
              <button
                type="button"
                onClick={() => setMode("train")}
                className={`px-3 py-1 text-sm font-medium ${mode === "train" ? "bg-green-700 text-white" : "bg-card"}`}
              >
                列車
              </button>
              <button
                type="button"
                onClick={() => setMode("bus")}
                className={`px-3 py-1 text-sm font-medium ${mode === "bus" ? "bg-green-700 text-white" : "bg-card"}`}
              >
                バス
              </button>
            </div>
          )}
        </div>
      </div>

      {/* バス停検索（バスモード）／路線セレクタ（列車モード） */}
      {isBusStopView ? (
        <div className="rounded-lg border border-border bg-card px-4 py-2 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">バス停</span>
            <input
              type="text"
              value={busStopQuery}
              onChange={(e) => setBusStopQuery(e.target.value)}
              placeholder="バス停名・よみで検索"
              className="h-9 min-w-0 flex-1 rounded border border-border bg-background px-2 text-sm text-foreground"
            />
            <button
              type="button"
              onClick={() => setShowBusMap((v) => !v)}
              className={`flex items-center gap-1 rounded border px-2 py-1.5 text-sm ${
                showBusMap ? "border-green-700 bg-green-700 text-white" : "border-border bg-background hover:bg-accent"
              }`}
            >
              <MapIcon className="h-4 w-4" />
              地図から選ぶ
            </button>
            {selectedBusStop && (
              <span className="rounded bg-green-700 px-2 py-1 text-xs font-bold text-white">{selectedBusStop}</span>
            )}
          </div>
          {/* 地図からバス停を選ぶ（登録済み座標をもとにした簡易路線図） */}
          {showBusMap && (
            <div className="mt-2">
              <StopMapPicker
                coords={coords}
                stops={stat.busStops.map((s) => ({ name: s.name, kind: "bus" as const }))}
                routes={busMapRoutes}
                busMap={busMapSettings}
                selected={selectedBusStop}
                onSelect={(n) => {
                  setSelectedBusStop(n)
                  setBusStopQuery("")
                }}
              />
            </div>
          )}
          {(() => {
            const q = busStopQuery.trim()
            if (!q) return null
            const hits = stat.busStops
              .filter((s) => s.name.includes(q) || s.reading.includes(q))
              .slice(0, 12)
            if (hits.length === 0)
              return <p className="mt-2 text-xs text-muted-foreground">該当するバス停がありません。</p>
            return (
              <div className="mt-2 flex flex-wrap gap-1">
                {hits.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => {
                      setSelectedBusStop(s.name)
                      setBusStopQuery("")
                    }}
                    className="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-accent"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )
          })()}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 shadow-sm">
          <span className="text-sm text-muted-foreground">{source === "dynmap" || mode === "train" ? "路線" : "系統"}</span>
          <select
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            className="h-9 rounded border border-border bg-background px-2 text-sm font-medium text-foreground [&>option]:bg-background [&>option]:text-foreground"
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.name}
              </option>
            ))}
          </select>
          <span className="ml-auto text-xs text-muted-foreground">左=上り▲ / 右=下り▼</span>
        </div>
      )}

      {/* バス: 選択バス停に接近中のバス（実位置＝ライブ／ダイヤ予測＝時刻表） */}
      {isBusStopView && (
        <div className="rounded-lg border border-border bg-card shadow-sm">
          <div className="rounded-t-lg bg-green-700 px-4 py-2 text-center text-base font-bold text-white">
            {selectedBusStop ? `${selectedBusStop} に接近中のバス` : "バス停を選択してください"}
          </div>
          <div className="space-y-2 p-3">
            {!selectedBusStop ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                上の検索からバス停を選ぶと、そのバス停に停車する接近中のバスを表示します。
              </p>
            ) : busView.approaching.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                現在このバス停に接近中のバスはありません。
              </p>
            ) : (
              busView.approaching.map((b) => <BusApproachRow key={b.id} b={b} />)
            )}
          </div>
        </div>
      )}

      {/* 在線盤（鉄道＝列車モード） */}
      {!isBusStopView && (
      <div className="rounded-lg border border-border bg-card shadow-sm">
        {board && (
          <div
            className="rounded-t-lg px-4 py-2 text-center text-base font-bold text-white"
            style={{ backgroundColor: board.color }}
          >
            {board.name}
          </div>
        )}
        {(() => {
          const conns = board ? LINE_CONNECTIONS[board.name] || [] : []
          const firstStop = board?.segments[0]?.stops[0]
          const lastSegStops = board?.segments[board.segments.length - 1]?.stops
          const lastStop = lastSegStops?.[lastSegStops.length - 1]
          // 終端からの直線延長(島北線など)がタイトルや下端にはみ出さないよう、その分の余白を確保
          const topExt = conns.some((c) => c.type === "straight" && c.side === "up" && c.station === firstStop)
          const botExt = conns.some((c) => c.type === "straight" && c.side === "down" && c.station === lastStop)
          return (
            <div
              className="space-y-3 overflow-hidden px-3"
              style={{ paddingTop: topExt ? 76 : 12, paddingBottom: botExt ? 76 : 12 }}
            >
              {!board || board.segments.every((s) => s.stops.length === 0) ? (
                <p className="py-8 text-center text-sm text-muted-foreground">駅データがありません。</p>
              ) : (
                board.segments.map((sp, si) => (
                  <Segment key={si} sp={sp} color={board.color} connections={conns} />
                ))
              )}
            </div>
          )
        })()}
      </div>
      )}

      {/* Dynmap実位置: エラー・未マッピング */}
      {source === "dynmap" && (
        <div className="space-y-2">
          {rtmError && (
            <p className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-center text-sm text-destructive">
              {rtmError}
            </p>
          )}
          {!isDynBus && rtmUnmapped.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
              <p className="mb-1 text-sm font-semibold">線区に対応づかない列車（{rtmUnmapped.length}）</p>
              <p className="mb-2 text-xs text-muted-foreground">
                駅座標が未登録、または線区から離れた位置の列車です。管理画面「駅座標」でX/Zを登録すると盤上に表示されます。
              </p>
              <div className="flex flex-col gap-1">
                {rtmUnmapped.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-bold">{t.runNo}</span>
                    {/* 回送は種別「回送」だけにまとめる（行先は出さない） */}
                    {isDeadheadMarker(t) ? (
                      <span className="font-medium text-foreground">回送</span>
                    ) : (
                      <>
                        {t.type && <span className="font-medium text-foreground">{t.type}</span>}
                        {t.dest && <span className="text-muted-foreground">{formatHeadsign(t.dest, t.destNote)}</span>}
                      </>
                    )}
                    <span className="tabular-nums text-muted-foreground">
                      ({Math.round(t.x)}, {Math.round(t.z)})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {isDynBus && selectedBusStop && busView.unlocated.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
              <p className="mb-1 text-sm font-semibold">位置不明のバス（{busView.unlocated.length}）</p>
              <p className="mb-2 text-xs text-muted-foreground">
                バス停の座標が不足しており現在位置を特定できないバスです（系統・行先のみ）。
              </p>
              <div className="flex flex-col gap-1">
                {busView.unlocated.map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-green-700 px-1.5 py-0.5 font-bold text-white">{b.type}</span>
                    {b.dest && <span className="text-muted-foreground">{formatHeadsign(b.dest, b.destNote)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        {source === "dynmap"
          ? isDynBus
            ? `Dynmapのバスマーカー(RTM)を、選択したバス停に停車する系統・座標から現在位置へ対応づけています。${Math.round(REFRESH_MS / 1000)}秒ごとに自動更新。`
            : `Dynmapの列車マーカー(RTM)から実位置を取得し、駅座標をもとに線区へ対応づけています。${Math.round(REFRESH_MS / 1000)}秒ごとに自動更新。`
          : isBusStopView
            ? `運行中のバスのうち、選択したバス停にこれから停車する便を時刻表から推定して表示しています。${Math.round(REFRESH_MS / 1000)}秒ごとに自動更新。`
            : `位置はダイヤと遅延設定に基づく実時間の推定です。${Math.round(REFRESH_MS / 1000)}秒ごとに自動更新。列車は通っている線区すべてに表示されます。`}
      </p>

      {/* 運用詳細（ピンクリック） */}
      {selectedTrain && (
        <TrainDetailModal
          train={selectedTrain}
          color={stat.routeColorById.get(selectedTrain.routeId) || "#0891b2"}
          fromDynmap={source === "dynmap"}
          onClose={() => setSelectedTrain(null)}
        />
      )}
    </div>
  )
}
