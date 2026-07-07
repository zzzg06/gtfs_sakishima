import type { StationCoordinates } from "./station-coordinates"

// Dynmapのライブバス(ワールド座標)を、その系統の代表停車順(バス停名の並び)に対して測位し、
// 「選択したバス停にこれから停車する(接近中の)バスのみ、手前数停＋現在位置」を組み立てる純ロジック。
//
// バス停座標は一部の停にしか登録されていないため、列車のような区間補間ではなく
// 「座標を持つ停のうち最寄りの停へスナップ」して現在位置(停index)を求める。

export interface BusStripStop {
  name: string
  index: number // seq内のindex
  current: boolean // バスの現在位置(最寄り停)
  isTarget: boolean // 選択停
}

// 接近中バス1台ぶんの表示データ
export interface ApproachingBus {
  id: string
  line: string // 系統(route_short_name)
  dest: string // 行先(行先ラベル)
  stopsAway: number // 選択停まで残り停留所数
  beyondWindow: boolean // 現在位置が表示窓より手前(「N停以上前」)
  strip: BusStripStop[] // 手前lookBack停〜選択停
  delayed?: boolean // ダイヤ予測のみ: 遅延あり
  delayText?: string // ダイヤ予測のみ: 遅延表示テキスト
}

// 進行方向 forward で、選択停 sIdx の手前 lookBack 停〜選択停の表示窓を作る。
// 現在位置 cIdx が窓内なら current フラグを立て、窓より手前なら beyondWindow=true。
export function buildStrip(
  seq: string[],
  cIdx: number,
  sIdx: number,
  forward: boolean,
  lookBack: number,
): { strip: BusStripStop[]; beyondWindow: boolean } {
  const strip: BusStripStop[] = []
  if (forward) {
    for (let i = Math.max(0, sIdx - lookBack); i <= sIdx; i++) {
      strip.push({ name: seq[i], index: i, current: i === cIdx, isTarget: i === sIdx })
    }
  } else {
    for (let i = Math.min(seq.length - 1, sIdx + lookBack); i >= sIdx; i--) {
      strip.push({ name: seq[i], index: i, current: i === cIdx, isTarget: i === sIdx })
    }
  }
  return { strip, beyondWindow: !strip.some((s) => s.current) }
}

// 座標を持つ停のうち、(x,z)に最も近い停のseq内indexを返す（distも）。なければnull。
export function nearestStopIndex(
  x: number,
  z: number,
  seq: string[],
  coords: StationCoordinates,
): { index: number; dist: number } | null {
  let bestIdx = -1
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < seq.length; i++) {
    const c = coords[seq[i]]
    if (!c) continue
    const d = Math.hypot(x - c.x, z - c.z)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  if (bestIdx < 0) return null
  return { index: bestIdx, dist: bestDist }
}

// 連続重複を除いた停車順を返す（環状便で先頭末尾が同名でも各出現は残す）。
export function dedupeConsecutive(names: string[]): string[] {
  const out: string[] = []
  for (const n of names) if (out[out.length - 1] !== n) out.push(n)
  return out
}

export interface BuildApproachingParams {
  id: string
  line: string
  dest: string
  x: number
  z: number
  seq: string[] // 系統の代表停車順（dedupe済み想定）
  coords: StationCoordinates
  prev?: { x: number; z: number } // 前回座標（進行方向判定用。なければ前進と仮定）
  selectedStop: string
  lookBack?: number // 選択停の手前に見せる停数（既定4）
  maxSnapDist?: number // この距離(ブロック)以内に座標停が無ければ位置不明（既定400）
}

export type BuildApproachingResult =
  | { kind: "approaching"; bus: ApproachingBus }
  | { kind: "unlocated" } // 位置特定不可（座標停が遠い／無い）
  | { kind: "not-approaching" } // 選択停を通過済み等、これから停車しない

// 1台のバスについて、選択停に接近中かどうか・接近中なら表示窓を組み立てる。
export function buildApproachingBus(p: BuildApproachingParams): BuildApproachingResult {
  const lookBack = p.lookBack ?? 4
  const maxSnap = p.maxSnapDist ?? 400
  const seq = p.seq
  if (seq.length === 0) return { kind: "unlocated" }
  if (!seq.includes(p.selectedStop)) return { kind: "not-approaching" }

  const near = nearestStopIndex(p.x, p.z, seq, p.coords)
  if (!near || near.dist > maxSnap) return { kind: "unlocated" }
  const cIdx = near.index

  // 進行方向: 前回座標→現在の移動ベクトルと、seq上の前進方向(現在停→次停)の内積で判定。
  // 取れない場合は前進(index増加方向)と仮定。
  let forward = true
  if (p.prev) {
    const mvx = p.x - p.prev.x
    const mvz = p.z - p.prev.z
    if (Math.hypot(mvx, mvz) >= 2) {
      // 現在停の前後で座標が取れる隣接停を探して方向ベクトルを作る
      const cCoord = p.coords[seq[cIdx]]
      let nextCoord: { x: number; z: number } | undefined
      for (let i = cIdx + 1; i < seq.length; i++) {
        if (p.coords[seq[i]]) {
          nextCoord = p.coords[seq[i]]
          break
        }
      }
      if (cCoord && nextCoord) {
        const fx = nextCoord.x - cCoord.x
        const fz = nextCoord.z - cCoord.z
        forward = mvx * fx + mvz * fz >= 0
      }
    }
  }

  // 選択停 S: 進行方向の前方にある最初の出現を探す。
  let sIdx = -1
  if (forward) {
    for (let i = cIdx; i < seq.length; i++) {
      if (seq[i] === p.selectedStop) {
        sIdx = i
        break
      }
    }
  } else {
    for (let i = cIdx; i >= 0; i--) {
      if (seq[i] === p.selectedStop) {
        sIdx = i
        break
      }
    }
  }
  if (sIdx < 0) return { kind: "not-approaching" } // 前方に選択停が無い＝これから停車しない

  const stopsAway = Math.abs(sIdx - cIdx)
  const { strip, beyondWindow } = buildStrip(seq, cIdx, sIdx, forward, lookBack)

  return {
    kind: "approaching",
    bus: { id: p.id, line: p.line, dest: p.dest, stopsAway, beyondWindow, strip },
  }
}
