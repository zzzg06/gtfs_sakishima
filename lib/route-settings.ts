import { adminAuthHeaders } from "./admin-session"

// 経路探索の設定（乗り換え許容待ち時間など）。
// 徒歩は座標方式を廃止し、徒歩区間リスト（lib/walk-list.ts）で扱う。

export interface RouteSettings {
  maxTransferWaitMinutes: number // 乗り換え時の最大待ち時間（分）
}

export const DEFAULT_ROUTE_SETTINGS: RouteSettings = {
  maxTransferWaitMinutes: 30,
}

// route-finder が同期的に参照するためのモジュールキャッシュ
let cachedSettings: RouteSettings = { ...DEFAULT_ROUTE_SETTINGS }

export function getCachedRouteSettings(): RouteSettings {
  return cachedSettings
}

class RouteSettingsManager {
  async loadSettings(): Promise<RouteSettings> {
    try {
      const res = await fetch("/api/shared-data?type=route-settings")
      const result = await res.json()
      if (result.success) {
        cachedSettings = { ...DEFAULT_ROUTE_SETTINGS, ...(result.data || {}) }
        return cachedSettings
      }
    } catch (error) {
      console.error("[gtfs] route-settings の読み込みに失敗:", error)
    }
    return cachedSettings
  }

  async saveSettings(settings: RouteSettings): Promise<void> {
    const res = await fetch("/api/shared-data", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
      body: JSON.stringify({ action: "save", dataType: "route-settings", data: settings }),
    })
    const result = await res.json().catch(() => null)
    if (!res.ok || !result?.success) {
      throw new Error(result?.error || "設定の保存に失敗しました")
    }
    cachedSettings = { ...settings }
  }

  // 検索前に経路探索用の設定を読み込む
  async loadAll(): Promise<void> {
    await this.loadSettings()
  }
}

export const routeSettingsManager = new RouteSettingsManager()
