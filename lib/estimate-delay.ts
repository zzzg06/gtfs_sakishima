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
  const dm = Math.round(b.delay)
  const status: TrainDelay["status"] =
    dm > DELAY_TOLERANCE ? "delayed" : dm < -DELAY_TOLERANCE ? "early" : "on-time"

  // これからの停車駅と到着予想時刻（採用便の i+1 以降、通過駅は除外、遅延・サイクル込み）
  const upcoming: UpcomingArrival[] = []
  for (let j = b.fromIndex + 1; j < b.leg.stops.length && upcoming.length < 3; j++) {
    if (b.leg.pass?.[j]) continue
    const sched = Number.isFinite(b.leg.arrive[j]) ? b.leg.arrive[j] : b.leg.depart[j]
    if (!Number.isFinite(sched)) continue
    upcoming.push({ name: b.leg.stops[j], time: fmtClock(sched + b.offH * 60 + b.delay) })
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
