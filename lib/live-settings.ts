import { adminAuthHeaders } from "./admin-session"

// 走行位置表示の設定。表示元（ダイヤ予測 / Dynmap実位置）は**管理者だけ**が切り替えられ、
// 一般ページ(/live)と管理画面の運行状況マップの両方がこの設定に従う。

export type LivePositionSource = "schedule" | "dynmap"

export interface LiveSettings {
  positionSource: LivePositionSource
}

export const DEFAULT_LIVE_SETTINGS: LiveSettings = {
  positionSource: "schedule",
}

let cached: LiveSettings = { ...DEFAULT_LIVE_SETTINGS }

export function getCachedLiveSettings(): LiveSettings {
  return cached
}

class LiveSettingsManager {
  async load(): Promise<LiveSettings> {
    try {
      const res = await fetch("/api/shared-data?type=live-settings")
      const result = await res.json()
      if (result.success) {
        cached = { ...DEFAULT_LIVE_SETTINGS, ...(result.data || {}) }
        return cached
      }
    } catch (error) {
      console.error("[gtfs] live-settings の読み込みに失敗:", error)
    }
    return cached
  }

  async save(settings: LiveSettings): Promise<void> {
    const res = await fetch("/api/shared-data", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
      body: JSON.stringify({ action: "save", dataType: "live-settings", data: settings }),
    })
    const result = await res.json().catch(() => null)
    if (!res.ok || !result?.success) {
      throw new Error(result?.error || "設定の保存に失敗しました")
    }
    cached = { ...settings }
  }
}

export const liveSettingsManager = new LiveSettingsManager()
