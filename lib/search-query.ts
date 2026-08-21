import type { TransportOptions } from "./route-finder"

// 検索条件をURL（/result?from=..&to=..&type=..&time=HHMM&...）に載せる/読むためのヘルパー。
// 画面遷移を実ルートに載せ、共有・リロード・ブラウザの戻る/進むを自然に動かす。

export type SearchType = "dep" | "arr" | "none"

export interface ParsedSearch {
  from: string // 出発の駅/停留所名
  to: string // 到着の駅/停留所名
  type: SearchType
  time: string // "HHMM"（type==="none" のときは ""）
  options: TransportOptions
}

// 交通手段オプションはURLを短く保つため、既定値と異なるものだけ載せる
const DEFAULT_OPTIONS: TransportOptions = {
  allowWalking: true,
  allowBus: true,
  preferBus: false,
  allowTaxi: false,
  showExcludedTrips: false,
}

export function buildResultUrl(
  from: string,
  to: string,
  type: SearchType,
  time: string,
  options: TransportOptions,
): string {
  const p = new URLSearchParams()
  p.set("from", from)
  p.set("to", to)
  p.set("type", type)
  if (type !== "none" && time) p.set("time", time)
  if (options.allowWalking === false) p.set("w", "0")
  if (options.allowBus === false) p.set("b", "0")
  if (options.preferBus) p.set("pb", "1")
  if (options.allowTaxi) p.set("tx", "1")
  if (options.showExcludedTrips) p.set("ex", "1")
  return `/result?${p.toString()}`
}

export function parseSearch(sp: URLSearchParams): ParsedSearch | null {
  const from = sp.get("from") || ""
  const to = sp.get("to") || ""
  if (!from || !to) return null
  const t = sp.get("type")
  const type: SearchType = t === "arr" ? "arr" : t === "none" ? "none" : "dep"
  return {
    from,
    to,
    type,
    time: sp.get("time") || "",
    options: {
      allowWalking: sp.get("w") !== "0",
      allowBus: sp.get("b") !== "0",
      preferBus: sp.get("pb") === "1",
      allowTaxi: sp.get("tx") === "1",
      showExcludedTrips: sp.get("ex") === "1",
    },
  }
}

export { DEFAULT_OPTIONS }

// ---- 共有用の短縮URL（/r/<トークン>） ----
//
// 検索条件を "出発|到着|種別|時刻|オプション" に詰めてUTF-8→base64urlにする。
// 例: 咲島港|中原台|d|0902 → 5ZKy5bO25rivfOS4reWOn-WPsHxkfDA5MDI
// 常にASCIIなので、どこにコピーしても長さが変わらない（%エンコードで伸びない）。
// 既存の /result?from=..&to=.. も引き続き使えるので、過去に共有したリンクは壊れない。

const TYPE_TO_CHAR: Record<SearchType, string> = { dep: "d", arr: "a", none: "n" }
const CHAR_TO_TYPE: Record<string, SearchType> = { d: "dep", a: "arr", n: "none" }

// オプションは既定と違うものだけ1文字ずつ並べる
const OPTION_FLAGS: { flag: string; get: (o: TransportOptions) => boolean; set: (o: TransportOptions) => void }[] = [
  { flag: "W", get: (o) => o.allowWalking === false, set: (o) => (o.allowWalking = false) },
  { flag: "B", get: (o) => o.allowBus === false, set: (o) => (o.allowBus = false) },
  { flag: "P", get: (o) => !!o.preferBus, set: (o) => (o.preferBus = true) },
  { flag: "X", get: (o) => !!o.allowTaxi, set: (o) => (o.allowTaxi = true) },
  { flag: "E", get: (o) => !!o.showExcludedTrips, set: (o) => (o.showExcludedTrips = true) },
]

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(token: string): string | null {
  try {
    const b64 = token.replace(/-/g, "+").replace(/_/g, "/")
    const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

export function encodeSearchToken(
  from: string,
  to: string,
  type: SearchType,
  time: string,
  options: TransportOptions,
): string {
  const flags = OPTION_FLAGS.filter((f) => f.get(options))
    .map((f) => f.flag)
    .join("")
  const parts = [from, to, TYPE_TO_CHAR[type], type !== "none" ? time : "", flags]
  while (parts.length > 3 && parts[parts.length - 1] === "") parts.pop() // 末尾の空欄は省く
  return toBase64Url(parts.join("|"))
}

export function decodeSearchToken(token: string): ParsedSearch | null {
  const text = fromBase64Url(token || "")
  if (!text) return null
  const [from, to, typeChar, time = "", flags = ""] = text.split("|")
  if (!from || !to) return null
  const options: TransportOptions = { ...DEFAULT_OPTIONS }
  for (const f of OPTION_FLAGS) if (flags.includes(f.flag)) f.set(options)
  const type = CHAR_TO_TYPE[typeChar] || "dep"
  return { from, to, type, time: type === "none" ? "" : time, options }
}

// 共有用の短いURL（/r/<トークン>）
export function buildShareUrl(
  from: string,
  to: string,
  type: SearchType,
  time: string,
  options: TransportOptions,
): string {
  return `/r/${encodeSearchToken(from, to, type, time, options)}`
}
