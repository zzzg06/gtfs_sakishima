import { adminAuthHeaders } from "./admin-session"
import type { StationCoordinates } from "./station-coordinates"

// バス停マップ（パンフレットの路線図画像を背景に使うための設定）。
//
// 画像は public/ に置き、そのパス（例: /bus-map.png）を imageUrl に設定する。
// バス停の位置は「ワールド座標(X/Z) → 画像ピクセル」の変換で自動配置するため、
// 基準点(refs)として実在のバス停を画像上でクリックして登録する（2点で概算、3点以上で精度が上がる）。

export interface BusMapRef {
  name: string // バス停名（座標が登録済みのもの）
  px: number // 画像上のX(px)
  py: number // 画像上のY(px)
}

export interface BusMapSettings {
  imageUrl: string // public配下のパス。空なら座標だけの簡易図にフォールバック
  refs: BusMapRef[]
}

export const DEFAULT_BUS_MAP_SETTINGS: BusMapSettings = { imageUrl: "", refs: [] }

// px = a*X + b*Z + e ／ py = c*X + d*Z + f
export interface BusMapTransform {
  a: number
  b: number
  e: number
  c: number
  d: number
  f: number
}

export function worldToPixel(t: BusMapTransform, x: number, z: number): { x: number; y: number } {
  return { x: t.a * x + t.b * z + t.e, y: t.c * x + t.d * z + t.f }
}

// 3x3 の連立方程式を解く（ガウスの消去法）。解けなければ null。
function solve3(m: number[][], v: number[]): number[] | null {
  const a = m.map((row, i) => [...row, v[i]])
  for (let i = 0; i < 3; i++) {
    let piv = i
    for (let r = i + 1; r < 3; r++) if (Math.abs(a[r][i]) > Math.abs(a[piv][i])) piv = r
    if (Math.abs(a[piv][i]) < 1e-9) return null
    ;[a[i], a[piv]] = [a[piv], a[i]]
    for (let r = 0; r < 3; r++) {
      if (r === i) continue
      const k = a[r][i] / a[i][i]
      for (let c2 = i; c2 < 4; c2++) a[r][c2] -= k * a[i][c2]
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]]
}

// 基準点からワールド座標→画像ピクセルの変換を求める。
// 2点: 回転＋等倍スケール＋平行移動（相似変換）／3点以上: 最小二乗のアフィン変換。
export function solveBusMapTransform(refs: BusMapRef[], coords: StationCoordinates): BusMapTransform | null {
  const pts = refs
    .map((r) => ({ ref: r, w: coords[r.name] }))
    .filter((p): p is { ref: BusMapRef; w: { x: number; z: number } } => !!p.w)
  if (pts.length < 2) return null

  if (pts.length === 2) {
    const [p1, p2] = pts
    // 複素数として (X + iZ) → (px + i py) の一次変換 k*w + t を解く
    const wr = p2.w.x - p1.w.x
    const wi = p2.w.z - p1.w.z
    const pr = p2.ref.px - p1.ref.px
    const pi = p2.ref.py - p1.ref.py
    const den = wr * wr + wi * wi
    if (den < 1e-9) return null
    const kr = (pr * wr + pi * wi) / den
    const ki = (pi * wr - pr * wi) / den
    const e = p1.ref.px - (kr * p1.w.x - ki * p1.w.z)
    const f = p1.ref.py - (ki * p1.w.x + kr * p1.w.z)
    return { a: kr, b: -ki, e, c: ki, d: kr, f }
  }

  // 最小二乗（px と py を独立に解く）
  let sxx = 0, sxz = 0, sx = 0, szz = 0, sz = 0, n = 0
  let sxpx = 0, szpx = 0, spx = 0, sxpy = 0, szpy = 0, spy = 0
  for (const p of pts) {
    const { x, z } = p.w
    const { px, py } = p.ref
    sxx += x * x
    sxz += x * z
    sx += x
    szz += z * z
    sz += z
    n += 1
    sxpx += x * px
    szpx += z * px
    spx += px
    sxpy += x * py
    szpy += z * py
    spy += py
  }
  const m = [
    [sxx, sxz, sx],
    [sxz, szz, sz],
    [sx, sz, n],
  ]
  const sx1 = solve3(m, [sxpx, szpx, spx])
  const sy1 = solve3(m, [sxpy, szpy, spy])
  if (!sx1 || !sy1) return null
  return { a: sx1[0], b: sx1[1], e: sx1[2], c: sy1[0], d: sy1[1], f: sy1[2] }
}

// 基準点の当てはまり具合（px単位のズレ）。位置合わせの確認用。
export function refResiduals(
  t: BusMapTransform,
  refs: BusMapRef[],
  coords: StationCoordinates,
): { name: string; dist: number }[] {
  const out: { name: string; dist: number }[] = []
  for (const r of refs) {
    const w = coords[r.name]
    if (!w) continue
    const p = worldToPixel(t, w.x, w.z)
    out.push({ name: r.name, dist: Math.hypot(p.x - r.px, p.y - r.py) })
  }
  return out
}

let cached: BusMapSettings = { ...DEFAULT_BUS_MAP_SETTINGS }

export function getCachedBusMapSettings(): BusMapSettings {
  return cached
}

class BusMapSettingsManager {
  async load(): Promise<BusMapSettings> {
    try {
      const res = await fetch("/api/shared-data?type=bus-map")
      const result = await res.json()
      if (result.success) {
        cached = { ...DEFAULT_BUS_MAP_SETTINGS, ...(result.data || {}) }
        return cached
      }
    } catch (error) {
      console.error("[gtfs] bus-map の読み込みに失敗:", error)
    }
    return cached
  }

  async save(settings: BusMapSettings): Promise<void> {
    const res = await fetch("/api/shared-data", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
      body: JSON.stringify({ action: "save", dataType: "bus-map", data: settings }),
    })
    const result = await res.json().catch(() => null)
    if (!res.ok || !result?.success) {
      throw new Error(result?.error || "バス停マップ設定の保存に失敗しました")
    }
    cached = { ...settings }
  }
}

export const busMapSettingsManager = new BusMapSettingsManager()
