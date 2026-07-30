// 列車の現在位置を「在線状態（どの駅にいる／どの駅間を走行中か）」として算出する純ロジック。
// 座標は不要で、駅参照だけで列車走行位置（在線表示）を作れる。サーバー(API)・クライアント両方から使える。
// 同梱ダイヤは8〜11時台の4時間分のみで実際は4時間ごとに繰り返すため、便を複製せず
// 各サイクルのオフセット(0/4/8/12時間)を当てて「今その便が走っているか」を判定する。

export interface TripLite {
  trip_id: string
  route_id: string
  trip_short_name?: string
  train_number?: string
  trip_headsign?: string
  direction_id?: number
}

// 運用詳細用: これから停車する駅と到着予定時刻
export interface UpcomingStop {
  name: string
  time: string // HH:MM（遅延・サイクルオフセット込みの予定到着）
}

export interface StopTimeLite {
  trip_id: string
  arrival_time: string
  departure_time: string
  stop_id: string
  stop_sequence: number
  pass?: boolean // 通過駅。在線区間の算出には使うが「停車駅」(次駅・これから停車する駅)には数えない
}

export interface RouteLite {
  route_id: string
  route_short_name?: string
  route_long_name?: string
  route_type: number
}

export interface TrainDelay {
  delayMinutes: number
  status: "on-time" | "delayed" | "early" | "cancelled"
}

// 在線状態（座標なし）
export interface TrainRunState {
  operationId: string // 運用番号（trip_short_name）
  trainNumber?: string // 列車番号
  tripId: string // 基本便のtrip_id
  routeId: string
  routeName: string
  routeType: number // 1=列車系, 3=バス
  headsign?: string
  direction: number // 0=下り, 1=上り
  status: TrainDelay["status"]
  delayMinutes: number
  atStation: boolean // 駅停車中=true / 駅間走行中=false
  fromStopId: string
  toStopId: string
  fromStop: string // 駅停車中は在線駅、走行中は直前の発駅
  toStop: string // 走行中の次駅（停車中はfromStopと同じ）
  nextStop?: string
  upcoming?: UpcomingStop[] // これから停車する駅（最大3駅）と到着予定時刻
  progress: number // 駅間走行の進捗 0..1
  // 増結（途中駅で連結して同一位置を走る他列車）。在線盤で1本にまとめて表示するために併結相手を保持。
  coupledWith?: { operationId: string; trainNumber?: string }[]
  // 終着到着後の居残り表示（terminalDwellMinutes による延命）。同じ運用が次の便を走り始めていたら捨てる。
  terminalDwell?: boolean
}

// 座標つき（Dynmapマーカー等で使用）
export interface TrainPosition extends TrainRunState {
  x: number
  z: number
}

export interface RunStateParams {
  trips: TripLite[]
  stopTimes: StopTimeLite[]
  routes: RouteLite[]
  stopNameById: Map<string, string>
  delaysByTripId: Map<string, TrainDelay>
  visibilityByTripId: Record<string, boolean>
  nowMinutes: number
  repeatOffsetsHours?: number[]
  terminalDwellMinutes?: number // 終着駅到着後も在線表示を残す分数（既定3分）
}

// 終着駅で到着後に在線を残す既定の待ち時間（分）。到着即消えを防ぐ。
const TERMINAL_DWELL_DEFAULT = 3

function parseTime(t: string): number {
  if (!t) return Number.NaN
  const [h, m, s] = t.split(":").map(Number)
  return (h || 0) * 60 + (m || 0) + (s || 0) / 60
}

// 0時からの経過分 → "HH:MM"（24時跨ぎは mod 24）
function fmtClock(min: number): string {
  const t = Math.round(min)
  const h = Math.floor(t / 60) % 24
  const m = ((t % 60) + 60) % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

// 在線状態（座標なし）を算出
export function computeTrainRunStates(params: RunStateParams): TrainRunState[] {
  const {
    trips,
    stopTimes,
    routes,
    stopNameById,
    delaysByTripId,
    visibilityByTripId,
    nowMinutes,
    repeatOffsetsHours = [0, 4, 8, 12],
    terminalDwellMinutes = TERMINAL_DWELL_DEFAULT,
  } = params

  const routeById = new Map(routes.map((r) => [r.route_id, r]))

  const byTrip = new Map<string, StopTimeLite[]>()
  for (const st of stopTimes) {
    const arr = byTrip.get(st.trip_id)
    if (arr) arr.push(st)
    else byTrip.set(st.trip_id, [st])
  }
  for (const arr of byTrip.values()) arr.sort((a, b) => a.stop_sequence - b.stop_sequence)

  const nameOf = (id: string) => stopNameById.get(id) || id
  const results: TrainRunState[] = []

  for (const trip of trips) {
    if (visibilityByTripId[trip.trip_id] === false) continue // 運休扱いは出さない
    const seq = byTrip.get(trip.trip_id)
    if (!seq || seq.length < 2) continue
    const route = routeById.get(trip.route_id)
    if (!route || route.route_id === "TAXI") continue

    const delay = delaysByTripId.get(trip.trip_id)
    if (delay?.status === "cancelled") continue
    const delayMin = delay?.delayMinutes || 0
    const status: TrainDelay["status"] = delay?.status || "on-time"

    const baseArr = seq.map((st) => parseTime(st.arrival_time || st.departure_time))
    const baseDep = seq.map((st) => parseTime(st.departure_time || st.arrival_time))

    const lastIdx = seq.length - 1
    for (const offH of repeatOffsetsHours) {
      const shift = offH * 60 + delayMin
      const arrive = baseArr.map((t) => t + shift)
      const depart = baseDep.map((t) => t + shift)
      // 終着到着後も terminalDwellMinutes 分は在線表示を残す（到着即消えを防ぐ）
      if (nowMinutes < depart[0] || nowMinutes > arrive[lastIdx] + terminalDwellMinutes) continue

      const base = {
        operationId: trip.trip_short_name || trip.trip_id,
        trainNumber: trip.train_number,
        tripId: trip.trip_id,
        routeId: route.route_id,
        routeName: route.route_short_name || route.route_long_name || "",
        routeType: route.route_type,
        headsign: trip.trip_headsign,
        direction: trip.direction_id ?? 0,
        status,
        delayMinutes: delayMin,
      }

      // startIdx 以降のこれから停車する駅を最大count件、到着予定時刻つきで集める
      // （通過駅・分岐の連続重複は除外）
      const collectUpcoming = (startIdx: number, count = 3): UpcomingStop[] => {
        const out: UpcomingStop[] = []
        let lastId = startIdx > 0 ? seq[startIdx - 1].stop_id : null
        for (let j = startIdx; j < seq.length && out.length < count; j++) {
          if (seq[j].pass || seq[j].stop_id === lastId) continue
          lastId = seq[j].stop_id
          out.push({ name: nameOf(seq[j].stop_id), time: fmtClock(arrive[j]) })
        }
        return out
      }
      // startIdx 以降で最初に「停車する」駅名（通過駅は飛ばす）
      const nextStopName = (startIdx: number): string | undefined => {
        for (let j = startIdx; j < seq.length; j++) {
          if (!seq[j].pass) return nameOf(seq[j].stop_id)
        }
        return undefined
      }

      let placed: TrainRunState | null = null
      for (let i = 0; i < seq.length; i++) {
        // 駅停車中（終着駅は到着後 terminalDwellMinutes 分まで在線を残す）
        const effDepart = i === lastIdx ? Math.max(depart[i], arrive[i] + terminalDwellMinutes) : depart[i]
        if (nowMinutes >= arrive[i] && nowMinutes <= effDepart) {
          placed = {
            ...base,
            // 終着駅で本来の発時刻を過ぎている＝居残り表示ぶん
            terminalDwell: i === lastIdx && nowMinutes > depart[i],
            atStation: true,
            fromStopId: seq[i].stop_id,
            toStopId: seq[i].stop_id,
            fromStop: nameOf(seq[i].stop_id),
            toStop: nameOf(seq[i].stop_id),
            nextStop: nextStopName(i + 1),
            upcoming: collectUpcoming(i + 1),
            progress: 0,
          }
          break
        }
        // 駅間走行中
        if (i < seq.length - 1 && nowMinutes >= depart[i] && nowMinutes < arrive[i + 1]) {
          // 分岐駅は同一stop_idが連続して現れる。その区間にいる場合は実際は当該駅に在線中とみなす
          if (seq[i].stop_id === seq[i + 1].stop_id) {
            placed = {
              ...base,
              atStation: true,
              fromStopId: seq[i].stop_id,
              toStopId: seq[i].stop_id,
              fromStop: nameOf(seq[i].stop_id),
              toStop: nameOf(seq[i].stop_id),
              nextStop: nextStopName(i + 2),
              upcoming: collectUpcoming(i + 2),
              progress: 0,
            }
            break
          }
          const span = arrive[i + 1] - depart[i]
          const frac = span > 0 ? (nowMinutes - depart[i]) / span : 0
          placed = {
            ...base,
            atStation: false,
            fromStopId: seq[i].stop_id,
            toStopId: seq[i + 1].stop_id,
            fromStop: nameOf(seq[i].stop_id),
            toStop: nameOf(seq[i + 1].stop_id),
            nextStop: nextStopName(i + 1),
            upcoming: collectUpcoming(i + 1),
            progress: Math.max(0, Math.min(1, frac)),
          }
          break
        }
      }

      if (placed) results.push(placed)
      break // 1便につき同時に走るサイクルは1つ
    }
  }

  // 同一運用が二重に出るのを防ぐ: 次の便を走り始めているのに、前の便が終着の居残り表示で
  // 残っている場合はその居残りを捨てる（スタフ上、前便の到着より次便の発車が早い運用がある）。
  const activeOps = new Set(results.filter((r) => !r.terminalDwell).map((r) => r.operationId))
  return results.filter((r) => !(r.terminalDwell && activeOps.has(r.operationId)))
}

// 座標つき位置（Dynmapマーカー用）。在線状態 + 駅座標を補間。座標未登録の駅は除外。
export function computeTrainPositions(
  params: RunStateParams & { coordsByName: Record<string, { x: number; z: number }> },
): TrainPosition[] {
  const { coordsByName } = params
  const states = computeTrainRunStates(params)
  const out: TrainPosition[] = []
  for (const s of states) {
    if (s.atStation) {
      const c = coordsByName[s.fromStop]
      if (!c) continue
      out.push({ ...s, x: c.x, z: c.z })
    } else {
      const c1 = coordsByName[s.fromStop]
      const c2 = coordsByName[s.toStop]
      if (!c1 || !c2) continue
      out.push({
        ...s,
        x: Math.round(c1.x + (c2.x - c1.x) * s.progress),
        z: Math.round(c1.z + (c2.z - c1.z) * s.progress),
      })
    }
  }
  return out
}

// 実時間(JST)の「0時からの経過分」を返す
export function nowMinutesInTokyo(date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || "0")
  let h = get("hour")
  if (h === 24) h = 0
  return h * 60 + get("minute") + get("second") / 60
}
