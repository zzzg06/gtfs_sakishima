import { gtfsParser } from "./gtfs-parser"
import { getCachedTripVisibilitySettings } from "./delay-manager"
import { buildOperationSchedule, resolveScheduledLeg } from "./estimate-delay"
import { isDeadheadMarker, locateRtmMarkers, resolveRtmStatesWithSchedule, type RtmMarker } from "./rtm-locate"
import { isExtraOperationNumber, resolveOperationNumber } from "./operation-number"
import { stationCoordinateManager, type StationCoordinates } from "./station-coordinates"
import { computeTrainRunStates, nowMinutesInTokyo } from "./train-position"

// 運行情報ページの「自動判定」用に、いま遅れが出ているかをDynmapの実位置から調べる。
// 列車は在線盤と同じ突き合わせ（rtm-locate）を、バスは最寄り停留所の時刻との差を使う。
// Dynmapのマーカーが取れない場合は「遅延なし」として扱う（誤って遅延表示を出さない）。

export interface DelayStat {
  delayed: number // 遅れている本数
  maxDelay: number // 最大遅延（分）
  total: number // 実位置が取れている本数
}

export interface DelaySummary {
  train: DelayStat
  bus: DelayStat
  available: boolean // Dynmapの実位置が取得できたか
}

const EMPTY: DelaySummary = {
  train: { delayed: 0, maxDelay: 0, total: 0 },
  bus: { delayed: 0, maxDelay: 0, total: 0 },
  available: false,
}

// バスの遅延: マーカーにいちばん近い「その運用の停留所」を現在地とみなし、時刻表と突き合わせる
function busDelayMinutes(
  runNo: string,
  x: number,
  z: number,
  busOperationIds: string[],
  schedule: ReturnType<typeof buildOperationSchedule>["schedule"],
  coords: StationCoordinates,
  nowMinutes: number,
): number | null {
  const op = resolveOperationNumber(runNo, busOperationIds)
  if (!op) return null
  const legs = schedule[op]
  if (!legs || legs.length === 0) return null
  let nearest: { name: string; dist: number } | null = null
  for (const leg of legs) {
    for (const name of leg.stops) {
      const c = coords[name]
      if (!c) continue
      const dist = Math.hypot(x - c.x, z - c.z)
      if (!nearest || dist < nearest.dist) nearest = { name, dist }
    }
  }
  if (!nearest) return null
  const r = resolveScheduledLeg(
    { operationId: op, fromStop: nearest.name, toStop: nearest.name, atStation: true, progress: 0 },
    schedule,
    nowMinutes,
  )
  return r.matched ? r.delayMinutes : null
}

export async function detectCurrentDelays(): Promise<DelaySummary> {
  if (!gtfsParser.hasData()) return EMPTY
  let coords: StationCoordinates = {}
  let markers: RtmMarker[] = []
  try {
    const [loadedCoords, res] = await Promise.all([
      stationCoordinateManager.load(),
      fetch("/api/rtm-trains").then((r) => r.json()),
    ])
    if (!res?.success) return EMPTY
    coords = loadedCoords
    markers = (res.trains as RtmMarker[]) || []
  } catch {
    return EMPTY
  }

  const trips = gtfsParser.getTrips()
  const stopTimes = gtfsParser.getAllStopTimes()
  const routes = gtfsParser.getRoutes()
  const stopNameById = new Map<string, string>()
  for (const s of gtfsParser.getStops()) if (!stopNameById.has(s.stop_id)) stopNameById.set(s.stop_id, s.stop_name)
  const { schedule, trainOperationIds, busOperationIds } = buildOperationSchedule({
    trips,
    stopTimes,
    routes,
    stopNameById,
  })
  const nowMinutes = nowMinutesInTokyo()

  // 行先での運用特定に使う「ダイヤ上いま走っている便」
  const scheduleStates = computeTrainRunStates({
    trips,
    stopTimes,
    routes,
    stopNameById,
    delaysByTripId: new Map(),
    visibilityByTripId: getCachedTripVisibilitySettings(),
    nowMinutes,
  })

  const { states, buses } = locateRtmMarkers({
    markers,
    coords,
    prevPos: new Map(),
    lastDir: new Map(),
  })
  const resolved = resolveRtmStatesWithSchedule({
    states,
    operationSchedule: schedule,
    trainOperationIds,
    scheduleStates,
    coords,
    nowMinutes,
  })

  const train: DelayStat = { delayed: 0, maxDelay: 0, total: 0 }
  for (const s of resolved) {
    // 回送・臨時はダイヤと突き合わせていないので遅延判定の対象外
    if (s.isDeadhead || s.isExtra) continue
    train.total++
    if (s.delayMinutes > 0) {
      train.delayed++
      train.maxDelay = Math.max(train.maxDelay, s.delayMinutes)
    }
  }

  const bus: DelayStat = { delayed: 0, maxDelay: 0, total: 0 }
  for (const b of buses) {
    if (isDeadheadMarker(b) || isExtraOperationNumber(b.runNo || "")) continue
    const d = busDelayMinutes(b.runNo || "", b.x, b.z, busOperationIds, schedule, coords, nowMinutes)
    if (d == null) continue
    bus.total++
    if (d > 0) {
      bus.delayed++
      bus.maxDelay = Math.max(bus.maxDelay, d)
    }
  }

  return { train, bus, available: true }
}
