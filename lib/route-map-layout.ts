// 路線図（運行状況マップ）の模式レイアウト。
// 在線表示(/live)の「縦1線ずつ」に対し、こちらは路線網全体を1枚の路線図として描くための座標定義。
// 座標はSVGユーザー空間の固定値（手描きの模式図）。駅の物理座標(station-coordinates)とは無関係で、
// 見やすさ優先で環状＋枝を長方形に整形している。駅の並びは lib/rail-lines.ts の線区定義に一致させる。

import { RAIL_LINES } from "./rail-lines"

export interface Pt {
  x: number
  y: number
}

export type LabelSide = "left" | "right" | "top" | "bottom"

export interface MapStation {
  name: string
  x: number
  y: number
  side: LabelSide // 駅名を置く向き
  dx?: number // 微調整（重なり回避用）
  dy?: number
}

// 路線の描画経路。文字列=駅（MAP_STATIONSの座標を使う）／[x,y]=駅のない屈曲点。
export interface MapLineDraw {
  name: string // RAIL_LINES の線区名（凡例・在線集計のキー）
  color?: string // 省略時は RAIL_LINES の色
  points: (string | [number, number])[]
}

export const MAP_VIEWBOX = { width: 1500, height: 940 }

// 環状(咲島線の西側＋島北線の東側)を長方形に、枝を上下左右へ伸ばす。
export const MAP_STATIONS: MapStation[] = [
  // 咲島線 桐立方面（西の横一列）
  { name: "桐立", x: 90, y: 150, side: "bottom" },
  { name: "県道", x: 190, y: 150, side: "bottom" },
  { name: "小島", x: 290, y: 150, side: "bottom" },
  { name: "桐立埠頭", x: 390, y: 150, side: "bottom" },
  { name: "海央皇", x: 490, y: 150, side: "bottom" },
  // 環状の左上角（咲島線↔島北線の分岐）
  { name: "島北出坂", x: 600, y: 150, side: "right", dx: 6 },
  // 咲島線 環状の左辺
  { name: "咲西浜", x: 600, y: 300, side: "left" },
  { name: "助が丘", x: 600, y: 420, side: "left" },
  { name: "八つ橋", x: 600, y: 530, side: "left" },
  // 島北線 環状の上辺
  { name: "上砥", x: 700, y: 50, side: "top" },
  { name: "船上湯本", x: 900, y: 50, side: "top" },
  // 島北線 環状の右辺
  { name: "天玉寺", x: 1160, y: 150, side: "right" },
  { name: "咲東崎", x: 1160, y: 300, side: "right" },
  { name: "新咲市場", x: 1160, y: 450, side: "right" },
  // 島北線 環状の下辺（大岩＝御東方面の分岐、中原台＝最大の分岐駅）
  { name: "大岩", x: 1010, y: 640, side: "top" },
  { name: "中原台", x: 740, y: 640, side: "bottom", dx: -70, dy: 4 },
  // 咲島線 咲島港方面（中原台から南へ）
  { name: "富田", x: 740, y: 750, side: "right" },
  { name: "咲島港", x: 740, y: 860, side: "right" },
  // 木古川線（中原台から環状の内側を北へ）
  { name: "葛敷", x: 740, y: 500, side: "right" },
  { name: "木古川", x: 740, y: 390, side: "right" },
  { name: "神在月", x: 740, y: 280, side: "right" },
  { name: "笠丘", x: 740, y: 170, side: "right" },
  // 御東方面（大岩から南へ下りて東へ）
  { name: "豆島口", x: 1130, y: 780, side: "bottom" },
  { name: "兜島中央", x: 1260, y: 780, side: "bottom" },
  { name: "御東", x: 1390, y: 780, side: "bottom" },
]

export const MAP_LINES: MapLineDraw[] = [
  {
    name: "咲島線",
    points: [
      "桐立",
      "県道",
      "小島",
      "桐立埠頭",
      "海央皇",
      "島北出坂",
      "咲西浜",
      "助が丘",
      "八つ橋",
      [600, 640], // 環状の左下角
      "中原台",
      "富田",
      "咲島港",
    ],
  },
  {
    name: "島北線",
    points: [
      "島北出坂",
      [600, 50], // 環状の左上角
      "上砥",
      "船上湯本",
      [1160, 50], // 環状の右上角
      "天玉寺",
      "咲東崎",
      "新咲市場",
      [1160, 640], // 環状の右下角
      "大岩",
      "中原台",
    ],
  },
  {
    name: "木古川線",
    points: ["中原台", "葛敷", "木古川", "神在月", "笠丘"],
  },
  {
    // 大岩〜御東。RAIL_LINESでは咲島線と同色(青)だが、図では別線として見分けるため紫にする。
    // 中原台〜大岩は島北線と同一線路のため、この線では描かない（大岩から先だけ）。
    name: "咲島線（御東方面）",
    color: "#7c3aed",
    points: ["大岩", [1010, 780], "豆島口", "兜島中央", "御東"],
  },
]

function normalizeColor(c?: string): string {
  if (!c) return "#0891b2"
  if (c.startsWith("#")) return c
  if (/^[0-9A-Fa-f]{6}$/.test(c)) return `#${c}`
  return "#0891b2"
}

// 図に描く線区の色（レイアウトの指定 > RAIL_LINES の色）
export function mapLineColor(name: string): string {
  const override = MAP_LINES.find((l) => l.name === name)?.color
  if (override) return normalizeColor(override)
  return normalizeColor(RAIL_LINES.find((l) => l.name === name)?.color)
}

export const STATION_POS: Map<string, Pt> = new Map(MAP_STATIONS.map((s) => [s.name, { x: s.x, y: s.y }]))

// 角を丸めたポリラインのパス文字列。屈曲点で半径rの円弧（2次ベジェ）を挟む。
export function roundedPath(pts: Pt[], r = 30): string {
  if (pts.length === 0) return ""
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    const a = pts[i - 1]
    const b = pts[i + 1]
    const l1 = Math.hypot(a.x - p.x, a.y - p.y)
    const l2 = Math.hypot(b.x - p.x, b.y - p.y)
    const cross = (a.x - p.x) * (b.y - p.y) - (a.y - p.y) * (b.x - p.x)
    const rr = Math.min(r, l1 / 2, l2 / 2)
    // 直線上の点（外積≒0）や極端に短い区間は丸めない
    if (rr < 2 || Math.abs(cross) < 1 || l1 === 0 || l2 === 0) {
      d += ` L ${p.x} ${p.y}`
      continue
    }
    const p1 = { x: p.x + ((a.x - p.x) / l1) * rr, y: p.y + ((a.y - p.y) / l1) * rr }
    const p2 = { x: p.x + ((b.x - p.x) / l2) * rr, y: p.y + ((b.y - p.y) / l2) * rr }
    d += ` L ${p1.x} ${p1.y} Q ${p.x} ${p.y} ${p2.x} ${p2.y}`
  }
  const last = pts[pts.length - 1]
  return `${d} L ${last.x} ${last.y}`
}

// 線区の描画パス（駅＋屈曲点を順に結ぶ）
export function linePath(line: MapLineDraw): string {
  return roundedPath(linePoints(line))
}

export function linePoints(line: MapLineDraw): Pt[] {
  const out: Pt[] = []
  for (const p of line.points) {
    if (typeof p === "string") {
      const pt = STATION_POS.get(p)
      if (pt) out.push(pt)
    } else out.push({ x: p[0], y: p[1] })
  }
  return out
}

// 隣接駅間の描画経路（屈曲点を含む）と隣接関係。列車位置の補間に使う。
const EDGES = new Map<string, Pt[]>()
const ADJ = new Map<string, Set<string>>()

function addAdj(a: string, b: string) {
  if (!ADJ.has(a)) ADJ.set(a, new Set())
  if (!ADJ.has(b)) ADJ.set(b, new Set())
  ADJ.get(a)!.add(b)
  ADJ.get(b)!.add(a)
}

for (const line of MAP_LINES) {
  let prev: string | null = null
  let bends: Pt[] = []
  for (const p of line.points) {
    if (typeof p !== "string") {
      bends.push({ x: p[0], y: p[1] })
      continue
    }
    const pt = STATION_POS.get(p)
    if (!pt) continue
    if (prev) {
      const chain = [STATION_POS.get(prev)!, ...bends, pt]
      if (!EDGES.has(`${prev}|${p}`)) {
        EDGES.set(`${prev}|${p}`, chain)
        EDGES.set(`${p}|${prev}`, [...chain].reverse())
      }
      addAdj(prev, p)
    }
    prev = p
    bends = []
  }
}

// from→to の駅間経路（非隣接＝通過運転でも最大maxHops駅までは経路を探す）
function findChain(from: string, to: string, maxHops = 4): Pt[] | null {
  const direct = EDGES.get(`${from}|${to}`)
  if (direct) return direct
  if (!ADJ.has(from) || !ADJ.has(to)) return null
  // 幅優先で駅列を求め、辺の描画経路を連結する
  const queue: string[][] = [[from]]
  const seen = new Set([from])
  while (queue.length > 0) {
    const path = queue.shift()!
    const last = path[path.length - 1]
    if (path.length > maxHops + 1) continue
    for (const nx of ADJ.get(last) || []) {
      if (nx === to) {
        const full = [...path, nx]
        const pts: Pt[] = []
        for (let i = 0; i < full.length - 1; i++) {
          const seg = EDGES.get(`${full[i]}|${full[i + 1]}`)
          if (!seg) return null
          pts.push(...(i === 0 ? seg : seg.slice(1)))
        }
        return pts
      }
      if (seen.has(nx)) continue
      seen.add(nx)
      queue.push([...path, nx])
    }
  }
  return null
}

export interface MapPlacement {
  x: number
  y: number
  dirX: number // 進行方向の単位ベクトル
  dirY: number
  normalX: number // 列車アイコンを線からずらす向き（駅名と反対側）
  normalY: number
}

const SIDE_VEC: Record<LabelSide, Pt> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
}

const STATION_SIDE = new Map<string, LabelSide>(MAP_STATIONS.map((s) => [s.name, s.side]))

// 列車アイコンを置く側。基準駅の駅名と反対側の法線を選ぶ（駅名と重ならないように）。
// 駅名が線と同じ向き（法線と直交）で判定できない場合は進行方向の左側にする。
function iconNormal(dirX: number, dirY: number, anchorStation?: string): Pt {
  const n = { x: dirY, y: -dirX } // 進行方向の左側
  const side = anchorStation ? STATION_SIDE.get(anchorStation) : undefined
  if (side) {
    const v = SIDE_VEC[side]
    const dot = n.x * v.x + n.y * v.y
    if (dot > 0.5) return { x: -n.x, y: -n.y } // 駅名と同じ側なら反転
  }
  return n
}

// ポリラインを長さ比 t (0..1) で進んだ点と、その地点の進行方向
function pointAlong(pts: Pt[], t: number): MapPlacement {
  const segs: number[] = []
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
    segs.push(d)
    total += d
  }
  const target = Math.max(0, Math.min(1, t)) * total
  let acc = 0
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i] >= target || i === segs.length - 1) {
      const f = segs[i] > 0 ? (target - acc) / segs[i] : 0
      const a = pts[i]
      const b = pts[i + 1]
      const len = segs[i] || 1
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        dirX: (b.x - a.x) / len,
        dirY: (b.y - a.y) / len,
        normalX: 0,
        normalY: 0,
      }
    }
    acc += segs[i]
  }
  const a = pts[0]
  return { x: a.x, y: a.y, dirX: 1, dirY: 0, normalX: 0, normalY: 0 }
}

// 在線状態（停車駅 or 駅間＋進捗）を図上の座標に置く。図に無い駅・経路不明ならnull。
export function placeOnMap(params: {
  atStation: boolean
  fromStop: string
  toStop: string
  progress: number
  nextStop?: string
}): MapPlacement | null {
  const { atStation, fromStop, toStop, progress, nextStop } = params
  if (atStation) {
    const p = STATION_POS.get(fromStop)
    if (!p) return null
    // 停車中は次駅があればその向きを進行方向とする（矢印の向き用）
    let dirX = 1
    let dirY = 0
    if (nextStop) {
      const chain = findChain(fromStop, nextStop)
      if (chain && chain.length >= 2) {
        const d = pointAlong(chain, 0)
        dirX = d.dirX
        dirY = d.dirY
      }
    }
    const n = iconNormal(dirX, dirY, fromStop)
    return { x: p.x, y: p.y, dirX, dirY, normalX: n.x, normalY: n.y }
  }
  const chain = findChain(fromStop, toStop)
  if (!chain) {
    const p = STATION_POS.get(fromStop)
    if (!p) return null
    return { x: p.x, y: p.y, dirX: 1, dirY: 0, normalX: 0, normalY: -1 }
  }
  const at = pointAlong(chain, progress)
  // 駅名との重なり回避は「近い側の駅」の駅名位置を基準にする
  const n = iconNormal(at.dirX, at.dirY, progress < 0.5 ? fromStop : toStop)
  return { ...at, normalX: n.x, normalY: n.y }
}

// 駅がどの線区に属するか（駅丸の色分け・分岐駅判定に使う）
export function linesAtStation(name: string): string[] {
  const out: string[] = []
  for (const line of MAP_LINES) {
    if (line.points.some((p) => typeof p === "string" && p === name)) out.push(line.name)
  }
  return out
}
