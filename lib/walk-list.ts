import embeddedWalk from "@/data/embedded-walk.json"

// 徒歩区間リスト（座標方式の代替）。
// SpotA⇔SpotB を time 分で徒歩移動できる。consecutive=true(Y)は連続徒歩可、false(W)は単独のみ。

export interface WalkSegment {
  id: string
  a: string
  b: string
  time: number // 分
  consecutive: boolean // Y=連続徒歩可
}

export interface WalkEdge {
  to: string
  time: number
  consecutive: boolean
  id: string
}

export interface WalkPathLeg {
  from: string
  to: string
  time: number
  id: string
}

let cachedSegments: WalkSegment[] = (embeddedWalk.segments as WalkSegment[]) || []
let adjacency = buildAdjacency(cachedSegments)

function buildAdjacency(segments: WalkSegment[]): Map<string, WalkEdge[]> {
  const adj = new Map<string, WalkEdge[]>()
  const add = (from: string, edge: WalkEdge) => {
    if (!adj.has(from)) adj.set(from, [])
    adj.get(from)!.push(edge)
  }
  for (const s of segments) {
    add(s.a, { to: s.b, time: s.time, consecutive: s.consecutive, id: s.id })
    add(s.b, { to: s.a, time: s.time, consecutive: s.consecutive, id: s.id })
  }
  return adj
}

export function getWalkSegments(): WalkSegment[] {
  return cachedSegments
}

export function getWalkNeighbors(spot: string): WalkEdge[] {
  return adjacency.get(spot) || []
}

// from から単独の徒歩区間で直接行ける spot 一覧（連続ルールに関わらず1本ならOK）
export function getDirectWalks(spot: string): WalkEdge[] {
  return getWalkNeighbors(spot)
}

// from→to を「単独1本」または「Y連続2本」で結ぶ最短時間の徒歩経路を返す。無ければ null。
export function findWalkPath(from: string, to: string): { time: number; legs: WalkPathLeg[] } | null {
  if (from === to) return null
  let best: { time: number; legs: WalkPathLeg[] } | null = null
  const consider = (time: number, legs: WalkPathLeg[]) => {
    if (!best || time < best.time) best = { time, legs }
  }

  // 1本（W/Yどちらでも可）
  for (const e of getWalkNeighbors(from)) {
    if (e.to === to) consider(e.time, [{ from, to, time: e.time, id: e.id }])
  }
  // Y連続2本（途中スポット M を経由、両方とも連続可）
  for (const e1 of getWalkNeighbors(from)) {
    if (!e1.consecutive || e1.to === to) continue
    for (const e2 of getWalkNeighbors(e1.to)) {
      if (!e2.consecutive || e2.to !== to) continue
      consider(e1.time + e2.time, [
        { from, to: e1.to, time: e1.time, id: e1.id },
        { from: e1.to, to, time: e2.time, id: e2.id },
      ])
    }
  }
  return best
}

// 将来サーバー（管理画面アップロード）から差し替える場合のフック
export function setWalkSegments(segments: WalkSegment[]): void {
  cachedSegments = segments
  adjacency = buildAdjacency(segments)
}
