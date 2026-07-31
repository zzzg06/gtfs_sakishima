import { getCachedStationCoordinates } from "./station-coordinates"

// タクシー（デマンド方式）の路線定義。
//
// パンフレットの「タクシー路線図」に描かれた着発地点と、それを結ぶ緑の線をそのままデータにしたもの。
// 時刻表は無く、路線図に描かれた区間だけを、呼び出し待ち時間つきで乗れる扱いにする。
// 駅の出入口（木古川駅東口/西口・助が丘駅南口）は駅とは別の地点として扱い、
// 駅で乗り換える場合は ENTRANCE_TO_STATION の徒歩でつなぐ。

export interface TaxiLine {
  points: string[] // 線上の着発地点（順番に並んでいる。隣接どうしが1区間）
  minutes?: number[] // 各区間の所要時間（分）。省略時は座標から概算し、座標が無ければ既定値
}

// 呼び出してから乗るまでの待ち時間（分）
export const TAXI_WAIT_MINUTES = 5
// 座標がある区間の所要時間を出すときの速度（ブロック/分）。
// 同梱ダイヤのバス実績（停車込みで中央値 約310ブロック/分）より少し速い想定。
const TAXI_SPEED = 350
// 座標が無い着発地点との区間に使う既定の所要時間（分）
const DEFAULT_RIDE_MINUTES = 6
// 乗車時間の下限（分）
const MIN_RIDE_MINUTES = 2

export const TAXI_LINES: TaxiLine[] = [
  { points: ["茶の畑", "木古川駅西口"] },
  { points: ["長池貯水池", "飯洲戸果樹", "木古川駅東口"] },
  { points: ["(バス)咲東崎灯台公園", "新咲市場"] },
  { points: ["鳥飼海の家", "助が丘駅南口"] }, // 助が丘駅から先（八つ橋・中原台方面）は鉄道でありタクシーではない
  { points: ["(バス)なみなかアリーナ", "八つ橋"] },
  { points: ["富浜桟橋", "中原台"] },
]

// 駅の出入口 → その駅（乗り換えは徒歩でつなぐ）
export const ENTRANCE_TO_STATION: Record<string, { station: string; walkMinutes: number }> = {
  木古川駅東口: { station: "木古川", walkMinutes: 2 },
  木古川駅西口: { station: "木古川", walkMinutes: 2 },
  助が丘駅南口: { station: "助が丘", walkMinutes: 2 },
}

// 路線図にしか無い（GTFSに駅・停留所として存在しない）着発地点。検索できるよう停留所として登録する。
export const TAXI_ONLY_POINTS = [
  "茶の畑",
  "長池貯水池",
  "飯洲戸果樹",
  "鳥飼海の家",
  "富浜桟橋",
  "木古川駅東口",
  "木古川駅西口",
  "助が丘駅南口",
]

export interface TaxiRide {
  from: string
  to: string
  minutes: number // 乗車時間（呼び出し待ちは含まない）
}

function rideMinutesBetween(a: string, b: string, explicit?: number): number {
  if (explicit != null) return explicit
  const coords = getCachedStationCoordinates()
  const ca = coords[a]
  const cb = coords[b]
  if (ca && cb) {
    const d = Math.hypot(ca.x - cb.x, ca.z - cb.z)
    return Math.max(MIN_RIDE_MINUTES, Math.round(d / TAXI_SPEED))
  }
  return DEFAULT_RIDE_MINUTES
}

// a→b がタクシーで乗れる区間か。乗れるなら乗車時間を返す（同一路線上なら途中の点を経由して通しで乗れる）。
export function findTaxiRide(a: string, b: string): TaxiRide | null {
  if (!a || !b || a === b) return null
  let best: TaxiRide | null = null
  for (const line of TAXI_LINES) {
    const ia = line.points.indexOf(a)
    const ib = line.points.indexOf(b)
    if (ia < 0 || ib < 0) continue
    const lo = Math.min(ia, ib)
    const hi = Math.max(ia, ib)
    let minutes = 0
    for (let i = lo; i < hi; i++) {
      minutes += rideMinutesBetween(line.points[i], line.points[i + 1], line.minutes?.[i])
    }
    if (!best || minutes < best.minutes) best = { from: a, to: b, minutes }
  }
  return best
}

// その地点からタクシーで行ける他の地点（乗車時間つき）
export function taxiDestinationsFrom(point: string): TaxiRide[] {
  const out = new Map<string, TaxiRide>()
  for (const line of TAXI_LINES) {
    if (!line.points.includes(point)) continue
    for (const p of line.points) {
      if (p === point) continue
      const ride = findTaxiRide(point, p)
      if (!ride) continue
      const cur = out.get(p)
      if (!cur || ride.minutes < cur.minutes) out.set(p, ride)
    }
  }
  return [...out.values()]
}

// タクシーの着発地点すべて
export function allTaxiPoints(): string[] {
  return [...new Set(TAXI_LINES.flatMap((l) => l.points))]
}

export function isTaxiPoint(name: string): boolean {
  return allTaxiPoints().includes(name)
}
