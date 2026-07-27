import type { TrainDelay } from "./train-position"

// Dynmap実位置の列車を時刻表に対応づけ、(1)遅延 (2)種別・行先 (3)進行方向 を解決する純ロジック。
// 公開盤はサーバーに書けないため、表示時にクライアントで都度推定する。
//
// 折り返し対策: 上り下りが同一区間を通る場所では、その区間が便の中に2回(往路/復路)現れる。
// それぞれ予定時刻が異なるため「現在時刻に最も近い候補」を選べば往路/復路を時刻で判別でき、
// 採用した区間の進行順(travelFrom→travelTo)から線区ローカルの向きが安定して定まる。

export interface ScheduleLeg {
  stops: string[] // 駅名（進行順。停車・通過を含む）
  arrive: number[] // 各駅の到着（0時からの分）
  depart: number[] // 各駅の出発（0時からの分）
  pass?: boolean[] // 各駅が通過か（到着予想の「これからの停車駅」では除外する）
  routeId: string
  routeName: string // 種別（route_short_name）
  headsign: string // 行先（trip_headsign）
}

// 到着予想で表示する「これからの停車駅」
export interface UpcomingArrival {
  name: string
  time: string // HH:MM（遅延・サイクルオフセット込みの予定到着）
}

// 運用番号(trip_short_name) → その運用の各便
export type OperationSchedule = Record<string, ScheduleLeg[]>

export interface ResolveInput {
  operationId: string
  fromStop: string // 線区定義順の区間端A（在線時は在線駅）
  toStop: string // 線区定義順の区間端B（在線時は同じ）
  atStation: boolean
  progress: number // A→B 上の進捗 0..1
}

export interface ResolveResult {
  matched: boolean
  delayMinutes: number
  status: TrainDelay["status"]
  routeId?: string
  routeName?: string
  headsign?: string
  travelFrom?: string // 進行順の発駅（折り返しを時刻で解決した実進行方向）
  travelTo?: string // 進行順の次駅
  nextStop?: string // 在線時: 便上での次停車駅（向き判定用）
  upcoming?: UpcomingArrival[] // これから停車する駅と到着予想時刻（遅延・サイクル込み）
}

// GTFSから「運用番号(trip_short_name)→便」の一覧を組み立てる。
// Dynmap実位置の遅延推定・運用突き合わせで使う（在線盤と運行状況マップで共通）。
// 連続同名駅(分岐)はマージし(到着=最初/出発=最後)、通過フラグは「どれかが停車なら停車」。
export interface BuildScheduleTrip {
  trip_id: string
  route_id: string
  trip_short_name?: string
  trip_headsign?: string
}
export interface BuildScheduleStopTime {
  trip_id: string
  arrival_time: string
  departure_time: string
  stop_id: string
  stop_sequence: number
  pass?: boolean
}
export interface BuildScheduleRoute {
  route_id: string
  route_short_name?: string
  route_long_name?: string
  route_type: number
}

export function buildOperationSchedule(params: {
  trips: BuildScheduleTrip[]
  stopTimes: BuildScheduleStopTime[] // 通過込み(getAllStopTimes)
  routes: BuildScheduleRoute[]
  stopNameById: Map<string, string>
}): { schedule: OperationSchedule; trainOperationIds: string[]; busOperationIds: string[] } {
  const { trips, stopTimes, routes, stopNameById } = params
  const toMin = (t?: string) => {
    if (!t) return Number.NaN
    const [h, m, s] = t.split(":").map(Number)
    return (h || 0) * 60 + (m || 0) + (s || 0) / 60
  }
  const byTrip = new Map<string, BuildScheduleStopTime[]>()
  for (const st of stopTimes) {
    const a = byTrip.get(st.trip_id)
    if (a) a.push(st)
    else byTrip.set(st.trip_id, [st])
  }
  for (const a of byTrip.values()) a.sort((x, y) => x.stop_sequence - y.stop_sequence)

  const routeById = new Map(routes.map((r) => [r.route_id, r]))
  const schedule: OperationSchedule = {}
  const busOperationIds = new Set<string>()
  const trainOperationIds = new Set<string>()
  for (const t of trips) {
    const op = t.trip_short_name
    if (!op) continue
    const seq = byTrip.get(t.trip_id)
    if (!seq || seq.length < 2) continue
    const r = routeById.get(t.route_id)
    const leg: ScheduleLeg = {
      stops: [],
      arrive: [],
      depart: [],
      pass: [],
      routeId: t.route_id,
      routeName: r?.route_short_name || r?.route_long_name || "",
      headsign: t.trip_headsign || "",
    }
    for (const st of seq) {
      const name = stopNameById.get(st.stop_id) || st.stop_id
      const arr = toMin(st.arrival_time || st.departure_time)
      const dep = toMin(st.departure_time || st.arrival_time)
      if (leg.stops[leg.stops.length - 1] === name) {
        leg.depart[leg.depart.length - 1] = dep
        if (!st.pass) leg.pass![leg.pass!.length - 1] = false
      } else {
        leg.stops.push(name)
        leg.arrive.push(arr)
        leg.depart.push(dep)
        leg.pass!.push(!!st.pass)
      }
    }
    if (leg.stops.length >= 2) {
      ;(schedule[op] ||= []).push(leg)
      if (r?.route_type === 3) busOperationIds.add(op)
      else trainOperationIds.add(op)
    }
  }
  return { schedule, trainOperationIds: [...trainOperationIds], busOperationIds: [...busOperationIds] }
}

// |delay| がこれを超える候補は誤マッチとみなして採用しない（分）
const MAX_REASONABLE_DELAY = 90
// この分以内の差は定刻とみなす（ユーザー要望: 1分許容）
const DELAY_TOLERANCE = 1

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

// 0時からの経過分 → "HH:MM"（24時跨ぎは mod 24）
function fmtClock(min: number): string {
  const t = Math.round(min)
  const h = Math.floor(t / 60) % 24
  const m = ((t % 60) + 60) % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

interface Candidate {
  abs: number
  delay: number
  routeId: string
  routeName: string
  headsign: string
  travelFrom: string
  travelTo: string
  nextStop?: string
  leg: ScheduleLeg // 採用した便（到着予想の算出に使う）
  fromIndex: number // 採用した便上での現在位置の駅index（これ以降が「これからの停車駅」）
  offH: number // 採用したサイクルオフセット（時間）
}

export function resolveScheduledLeg(
  input: ResolveInput,
  schedule: OperationSchedule,
  nowMinutes: number,
  repeatOffsetsHours: number[] = [0, 4, 8, 12],
): ResolveResult {
  const legs = schedule[input.operationId]
  if (!legs || legs.length === 0) return { matched: false, delayMinutes: 0, status: "on-time" }

  let best: Candidate | null = null
  const consider = (
    tLBase: number,
    leg: ScheduleLeg,
    travelFrom: string,
    travelTo: string,
    fromIndex: number,
    nextStop?: string,
  ) => {
    if (!Number.isFinite(tLBase)) return
    for (const offH of repeatOffsetsHours) {
      const delay = nowMinutes - (tLBase + offH * 60)
      const abs = Math.abs(delay)
      if (abs > MAX_REASONABLE_DELAY) continue
      if (!best || abs < best.abs) {
        best = { abs, delay, routeId: leg.routeId, routeName: leg.routeName, headsign: leg.headsign, travelFrom, travelTo, nextStop, leg, fromIndex, offH }
      }
    }
  }

  for (const leg of legs) {
    if (input.atStation) {
      for (let i = 0; i < leg.stops.length; i++) {
        if (leg.stops[i] !== input.fromStop) continue
        const t = Number.isFinite(leg.arrive[i]) ? leg.arrive[i] : leg.depart[i]
        consider(t, leg, input.fromStop, input.fromStop, i, i < leg.stops.length - 1 ? leg.stops[i + 1] : undefined)
      }
    } else {
      const p = clamp01(input.progress)
      for (let i = 0; i < leg.stops.length - 1; i++) {
        const s0 = leg.stops[i]
        const s1 = leg.stops[i + 1]
        // どちら向きでも便index i→i+1 が進行方向。これからの停車駅は i+1 以降。
        if (s0 === input.fromStop && s1 === input.toStop) {
          // 便は A→B 進行。進捗pはそのまま
          consider(leg.depart[i] + p * (leg.arrive[i + 1] - leg.depart[i]), leg, s0, s1, i)
        } else if (s0 === input.toStop && s1 === input.fromStop) {
          // 便は B→A 進行（折り返し等）。実位置の進捗pはA基準なので反転
          consider(leg.depart[i] + (1 - p) * (leg.arrive[i + 1] - leg.depart[i]), leg, s0, s1, i)
        }
      }
    }
  }

  if (!best) return { matched: false, delayMinutes: 0, status: "on-time" }
  const b: Candidate = best
  // 早着は扱わない（ユーザー要望）。定刻より早い場合は遅延0・定刻として扱う。
  const dm = Math.max(0, Math.round(b.delay))
  const status: TrainDelay["status"] = dm > DELAY_TOLERANCE ? "delayed" : "on-time"

  // これからの停車駅と到着予想時刻（採用便の i+1 以降、通過駅は除外、遅延・サイクル込み）
  const upcoming: UpcomingArrival[] = []
  for (let j = b.fromIndex + 1; j < b.leg.stops.length && upcoming.length < 3; j++) {
    if (b.leg.pass?.[j]) continue
    const sched = Number.isFinite(b.leg.arrive[j]) ? b.leg.arrive[j] : b.leg.depart[j]
    if (!Number.isFinite(sched)) continue
    // 到着予想も早着ぶんは見込まない（dm=0以上）
    upcoming.push({ name: b.leg.stops[j], time: fmtClock(sched + b.offH * 60 + dm) })
  }

  return {
    matched: true,
    delayMinutes: dm,
    status,
    routeId: b.routeId,
    routeName: b.routeName,
    headsign: b.headsign,
    travelFrom: b.travelFrom,
    travelTo: b.travelTo,
    nextStop: b.nextStop,
    upcoming,
  }
}
