// 在線表示（/live の走行位置・管理画面の運行状況マップ）で共通に使う表示ヘルパー。

import type { TrainDelay } from "./train-position"

export function routeColor(c?: string): string {
  if (!c || c.trim() === "") return "#0891b2"
  if (/^[0-9A-Fa-f]{6}$/.test(c)) return `#${c}`
  if (c.startsWith("#")) return c
  return "#0891b2"
}

// 早着は表示しない（定刻扱い）
export function delayInfo(s: TrainDelay["status"], m: number): { text: string; color: string; delayed: boolean } {
  switch (s) {
    case "delayed":
      return { text: `+${m}分`, color: "#dc2626", delayed: true }
    case "cancelled":
      return { text: "運休", color: "#6b7280", delayed: true }
    default:
      return { text: "定刻", color: "#16a34a", delayed: false }
  }
}

// 種別の盤面表示用の短縮表記（在線盤のバッジ用）
const SYUBETSU_ABBREV: Record<string, string> = {
  各駅停車: "各停",
  循環特快: "循特",
  特別快速: "特快",
  咲島循環: "循環",
}
export const abbrevSyubetsu = (name: string) => SYUBETSU_ABBREV[name] || name

// 行先の表示文字列。「行き」が付いていなければ補い、注記があれば括弧書きで後ろに添える。
// 例: ("電鉄坊崎", "咲西浜臨停") → 「電鉄坊崎行き（咲西浜臨停）」／("咲島港行き") → 「咲島港行き」
export function formatHeadsign(headsign?: string, note?: string): string {
  const base = (headsign || "").trim()
  if (!base) return ""
  const withSuffix = /(行き|ゆき|行)$/.test(base) ? base : `${base}行き`
  const n = (note || "").trim()
  return n ? `${withSuffix}（${n}）` : withSuffix
}

// 運用に割り当てた車両の画像（未割当・未設定は既定アイコン）
export function vehicleIconUrl(iconUrl: string | undefined, routeType: number): string {
  return iconUrl || (routeType === 3 ? "/vehicles/bus.png" : "/vehicles/2900.png")
}
