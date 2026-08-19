import { adminAuthHeaders } from "./admin-session"
import { TAXI_NOTICE_LINES, TAXI_NOTICE_TITLE } from "./taxi-routes"

// 運行情報ページ(/status)の掲載設定。管理者だけが変更でき、一般ページはこの設定に従う。
//
// - 列車／バスはそれぞれ 掲載する(on) / 掲載しない(off) / 自動判定(auto) を選べる。
//   auto は「遅れが出ているときだけ出す」。イベント開催時間外などは off にすれば何も出ない。
// - デマンド運行（タクシー・渡船）の注意書きは既定でタクシーの注意書きを流用する。
// - そのほか自由記述の項目をいくつでも足せる。

export type StatusDisplayMode = "on" | "off" | "auto"

export interface StatusSection {
  mode: StatusDisplayMode
  // on のときに掲載する本文。auto のときは遅延の自動文面に添える補足として使う（空でよい）
  message: string
}

export interface StatusNotice {
  id: string
  title: string
  body: string
  enabled: boolean
}

export interface StatusDemandNotice {
  enabled: boolean
  title: string
  lines: string[]
}

export interface StatusSettings {
  train: StatusSection
  bus: StatusSection
  demand: StatusDemandNotice
  notices: StatusNotice[]
}

export const DEFAULT_STATUS_SETTINGS: StatusSettings = {
  train: { mode: "auto", message: "" },
  bus: { mode: "auto", message: "" },
  // デマンド運行（タクシー・渡船）の注意書き。既定はタクシーの注意書きを流用
  demand: { enabled: true, title: TAXI_NOTICE_TITLE, lines: [...TAXI_NOTICE_LINES] },
  notices: [],
}

// 保存済みデータに新フィールドが無い場合に備えて既定値で埋める
export function normalizeStatusSettings(data: unknown): StatusSettings {
  const d = (data || {}) as Partial<StatusSettings>
  const section = (s: Partial<StatusSection> | undefined, def: StatusSection): StatusSection => ({
    mode: s?.mode === "on" || s?.mode === "off" || s?.mode === "auto" ? s.mode : def.mode,
    message: typeof s?.message === "string" ? s.message : def.message,
  })
  return {
    train: section(d.train, DEFAULT_STATUS_SETTINGS.train),
    bus: section(d.bus, DEFAULT_STATUS_SETTINGS.bus),
    demand: {
      enabled: d.demand?.enabled !== false,
      title: typeof d.demand?.title === "string" ? d.demand.title : DEFAULT_STATUS_SETTINGS.demand.title,
      lines: Array.isArray(d.demand?.lines) ? d.demand.lines.filter((l): l is string => typeof l === "string") : [...DEFAULT_STATUS_SETTINGS.demand.lines],
    },
    notices: Array.isArray(d.notices)
      ? d.notices
          .filter((n): n is StatusNotice => !!n && typeof n === "object")
          .map((n, i) => ({
            id: typeof n.id === "string" && n.id ? n.id : `notice-${i}`,
            title: typeof n.title === "string" ? n.title : "",
            body: typeof n.body === "string" ? n.body : "",
            enabled: n.enabled !== false,
          }))
      : [],
  }
}

let cached: StatusSettings = { ...DEFAULT_STATUS_SETTINGS }

export function getCachedStatusSettings(): StatusSettings {
  return cached
}

class StatusSettingsManager {
  async load(): Promise<StatusSettings> {
    try {
      const res = await fetch("/api/shared-data?type=status-settings")
      const result = await res.json()
      if (result.success) {
        cached = normalizeStatusSettings(result.data)
        return cached
      }
    } catch (error) {
      console.error("[gtfs] status-settings の読み込みに失敗:", error)
    }
    return cached
  }

  async save(settings: StatusSettings): Promise<void> {
    const res = await fetch("/api/shared-data", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
      body: JSON.stringify({ action: "save", dataType: "status-settings", data: settings }),
    })
    const result = await res.json().catch(() => null)
    if (!res.ok || !result?.success) {
      throw new Error(result?.error || "設定の保存に失敗しました")
    }
    cached = normalizeStatusSettings(settings)
  }
}

export const statusSettingsManager = new StatusSettingsManager()
