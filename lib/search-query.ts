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
