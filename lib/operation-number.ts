// 運用番号の表記ゆれを吸収して突き合わせる。
// Dynmapのマーカーは列車 K0x / バス B0x 形式、時刻表(GTFS trip_short_name)は K1〜K8 / バス1〜バス5 のように
// ゼロ詰めや接頭辞が異なるため、「種別(列車/バス)＋数字」で対応づける。
//
// - バス: 接頭辞 B、または「バス」を含む運用番号
// - 列車: 接頭辞 K
// 数字が完全一致する運用を優先し、バスは一致が無ければ番号が最も近い運用を採用する（nearest）。

import type { TrainRunState } from "./train-position"
import type { StationCoordinates } from "./station-coordinates"
import { abbrevSyubetsu } from "./train-display"

export type OperationKind = "train" | "bus" | "other"

export interface ParsedOperationNumber {
  raw: string
  kind: OperationKind
  num: number | null // 最初に現れる数字列（ゼロ詰めは無視。K01→1）
}

// 全角英数を半角へ
const toHalfWidth = (s: string) =>
  s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))

export function parseOperationNumber(raw: string): ParsedOperationNumber {
  const s = toHalfWidth((raw || "").trim()).toUpperCase()
  const m = s.match(/\d+/)
  const num = m ? Number(m[0]) : null
  let kind: OperationKind = "other"
  if (s.includes("バス") || s.startsWith("B")) kind = "bus"
  else if (s.startsWith("K")) kind = "train"
  return { raw, kind, num }
}

// 臨時運用の番号。K99(列車)/B99(バス)はダイヤ上の特定の運用ではなく「臨時」を表す約束。
const EXTRA_OPERATION_NUMBER = 99
export function isExtraOperationNumber(raw: string): boolean {
  const p = parseOperationNumber(raw)
  return p.num === EXTRA_OPERATION_NUMBER && p.kind !== "other"
}

export function isBusOperationNumber(raw: string): boolean {
  return parseOperationNumber(raw).kind === "bus"
}

export function isTrainOperationNumber(raw: string): boolean {
  return parseOperationNumber(raw).kind === "train"
}

// 同じ運用を指すか（K01 と K1、B02 と バス2 は同一とみなす）。
// 種別(列車/バス)が違う番号や、接頭辞のない番号（貸切03 等）は別物として扱う。
export function isSameOperation(a: string, b: string): boolean {
  if (a === b) return true
  const pa = parseOperationNumber(a)
  const pb = parseOperationNumber(b)
  if (pa.num == null || pb.num == null || pa.num !== pb.num) return false
  return pa.kind !== "other" && pa.kind === pb.kind
}

// candidates(時刻表側の運用番号)から raw に対応する運用番号を1つ選ぶ。
// nearest=true のときは数字が一致する候補が無ければ、同種別で番号が最も近い候補を採用する。
export function resolveOperationNumber(
  raw: string,
  candidates: Iterable<string>,
  opts: { nearest?: boolean } = {},
): string | null {
  const list = [...candidates]
  if (list.includes(raw)) return raw
  const p = parseOperationNumber(raw)
  if (p.num == null) return null
  // 接頭辞(K=列車 / B・バス=バス)が一致するものだけを対象にする。
  // 「貸切03」のように種別の分からない運用番号は、番号だけで K3 等に結び付けない。
  if (p.kind === "other") return null
  let nearest: { id: string; diff: number } | null = null
  for (const c of list) {
    const q = parseOperationNumber(c)
    if (q.num == null) continue
    if (q.kind !== p.kind) continue
    const diff = Math.abs(q.num - p.num)
    if (diff === 0) return c
    if (!opts.nearest) continue
    // 差が同じなら運用番号順で安定させる
    if (!nearest || diff < nearest.diff || (diff === nearest.diff && c.localeCompare(nearest.id, "ja", { numeric: true }) < 0)) {
      nearest = { id: c, diff }
    }
  }
  return nearest?.id ?? null
}

// 行先(幕)の表記ゆれを吸収する。「咲島港駅ゆき」「咲島港駅行き」「咲島港駅 行」→「咲島港駅」
export function normalizeHeadsign(s: string): string {
  return (s || "")
    .normalize("NFKC")
    .replace(/\s/g, "")
    .replace(/^\(バス\)/, "")
    .replace(/(行き|ゆき|行)$/, "")
}

// 行先が同じとみなせるか。完全一致のほか、「時計回り中原台駅前ゆき」と「中原台駅前（市街地循環）行き」の
// ように片方が他方を含む場合も一致とする（部分一致）。
export function headsignMatchLevel(a: string, b: string): 0 | 1 | null {
  const x = normalizeHeadsign(a)
  const y = normalizeHeadsign(b)
  if (!x || !y) return null
  if (x === y) return 0
  if (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x))) return 1
  return null
}

export function headsignMatches(a: string, b: string): boolean {
  return headsignMatchLevel(a, b) !== null
}

// 種別が同じとみなせるか。全角/半角・空白と「各駅停車＝各停」等の短縮表記の違いを吸収する。
// 片方が空（Dynmap側で種別未設定・ダイヤ側に種別名なし）のときは判定できないため一致扱いにする。
export function syubetsuMatches(a: string, b: string): boolean {
  const norm = (s: string) => abbrevSyubetsu((s || "").normalize("NFKC").replace(/\s/g, ""))
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return true
  return x === y
}

// Dynmapに表示されている行先から運用を特定する（運用番号で突き合わせできないときの補助）。
// 運行中の便のうち種別(列車/バス)が同じで行先が一致するものを採り（完全一致を部分一致より優先）、
// 複数該当する場合はマーカーの実座標にいちばん近い便を選ぶ。
export function matchOperationByHeadsign(
  dest: string,
  isBus: boolean,
  states: TrainRunState[],
  coords: StationCoordinates,
  pos?: { x: number; z: number },
): string | null {
  if (!normalizeHeadsign(dest)) return null
  const scored = states
    .filter((s) => (s.routeType === 3) === isBus)
    .map((s) => ({ s, level: headsignMatchLevel(dest, s.headsign || "") }))
    .filter((c): c is { s: TrainRunState; level: 0 | 1 } => c.level !== null)
  if (scored.length === 0) return null
  const bestLevel = Math.min(...scored.map((c) => c.level))
  const cands = scored.filter((c) => c.level === bestLevel).map((c) => c.s)
  if (cands.length === 1 || !pos) return cands[0].operationId
  let best: { id: string; dist: number } | null = null
  for (const s of cands) {
    const a = coords[s.fromStop]
    if (!a) continue
    const b = coords[s.toStop] || a
    const t = s.atStation ? 0 : s.progress
    const dist = Math.hypot(pos.x - (a.x + (b.x - a.x) * t), pos.z - (a.z + (b.z - a.z) * t))
    if (!best || dist < best.dist) best = { id: s.operationId, dist }
  }
  return best?.id ?? cands[0].operationId
}
