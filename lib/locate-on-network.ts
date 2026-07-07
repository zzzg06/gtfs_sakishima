import { RAIL_LINES } from "./rail-lines"
import type { StationCoordinates } from "./station-coordinates"

// ワールド座標(x,z)を、登録済み駅座標と線区定義(RAIL_LINES)を使って
// 「どの線区のどの駅間にいるか／どの駅に在線中か」へ対応づける（Dynmapの実位置→在線盤用）。
//
// 分岐駅での取り違えを防ぐため、単純な「全線分への最小垂直距離」ではなく、
// 「最寄り駅 S を求め、S から伸びる各区間(隣接駅方向)のうち、列車の方位(P-S)に最も合うものを選ぶ」方式。
// 長い弦が近くを通っても、最寄り駅から見た方向で正しい分岐を選べる。

export interface LocateResult {
  lineName: string
  segIndex: number // 線区segment内での区間index（A=stops[i], B=stops[i+1]）
  aName: string
  bName: string
  aIndex: number
  bIndex: number
  t: number // A→B上の射影位置 0..1
  perpDist: number // 選択区間（線分）への距離
  chordLen: number // A-B直線距離
  atStation: boolean
  station?: string
}

interface Edge {
  lineName: string
  segIndex: number
  a: string
  b: string
  ca: { x: number; z: number }
  cb: { x: number; z: number }
}

export function locateOnNetwork(
  x: number,
  z: number,
  coords: StationCoordinates,
  stationThreshold = 100, // 駅座標からこの距離(ブロック)以内は「停車中」とみなす
): LocateResult | null {
  // 1. 座標のある全区間(エッジ)と、駅→座標を収集
  const edges: Edge[] = []
  const stationCoord = new Map<string, { x: number; z: number }>()
  for (const line of RAIL_LINES) {
    line.segments.forEach((stops) => {
      for (let i = 0; i < stops.length - 1; i++) {
        const ca = coords[stops[i]]
        const cb = coords[stops[i + 1]]
        if (!ca || !cb) continue
        edges.push({ lineName: line.name, segIndex: i, a: stops[i], b: stops[i + 1], ca, cb })
        stationCoord.set(stops[i], ca)
        stationCoord.set(stops[i + 1], cb)
      }
    })
  }
  if (edges.length === 0) return null

  // 2. 最寄り駅 S
  let S: string | null = null
  let Sd = Number.POSITIVE_INFINITY
  for (const [name, c] of stationCoord) {
    const d = Math.hypot(x - c.x, z - c.z)
    if (d < Sd) {
      Sd = d
      S = name
    }
  }
  if (!S) return null
  const Sc = stationCoord.get(S)!

  // 3. S に接続する区間のうち、列車の方位(P-S)に最も合うものを選ぶ
  const incident = edges.filter((e) => e.a === S || e.b === S)
  if (incident.length === 0) return null
  const px = x - Sc.x
  const pz = z - Sc.z
  const plen = Math.hypot(px, pz)

  let best: Edge | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const e of incident) {
    const other = e.a === S ? e.cb : e.ca
    const ox = other.x - Sc.x
    const oz = other.z - Sc.z
    const olen = Math.hypot(ox, oz)
    // 駅にほぼ在線中なら方位は無意味→距離の近い区間でよい。方位が取れるならcos類似度。
    const score = plen < 1e-6 || olen < 1e-6 ? 0 : (px * ox + pz * oz) / (plen * olen)
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  if (!best) return null

  // 4. 選択区間上での射影位置・距離
  const abx = best.cb.x - best.ca.x
  const abz = best.cb.z - best.ca.z
  const len2 = abx * abx + abz * abz
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - best.ca.x) * abx + (z - best.ca.z) * abz) / len2)) : 0
  const projx = best.ca.x + abx * t
  const projz = best.ca.z + abz * t
  const perpDist = Math.hypot(x - projx, z - projz)

  return {
    lineName: best.lineName,
    segIndex: best.segIndex,
    aName: best.a,
    bName: best.b,
    aIndex: best.segIndex,
    bIndex: best.segIndex + 1,
    t,
    perpDist,
    chordLen: Math.sqrt(len2),
    atStation: Sd <= stationThreshold,
    station: Sd <= stationThreshold ? S : undefined,
  }
}
