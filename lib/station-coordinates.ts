import { adminAuthHeaders } from "./admin-session"

// 駅・停留所のMinecraftワールド座標（X/Z）。列車位置の算出やDynmapマーカー連携に使う。
// キーは stop_name（駅名／停留所名）。同名の番線・分岐重複は同一座標として扱う。

export interface StationCoordinate {
  x: number
  z: number
}

export type StationCoordinates = Record<string, StationCoordinate>

let cached: StationCoordinates = {}

export function getCachedStationCoordinates(): StationCoordinates {
  return cached
}

class StationCoordinateManager {
  async load(): Promise<StationCoordinates> {
    try {
      const res = await fetch("/api/shared-data?type=station-coordinates")
      const result = await res.json()
      if (result.success && result.data && typeof result.data === "object") {
        cached = result.data as StationCoordinates
        return cached
      }
    } catch (error) {
      console.error("[gtfs] station-coordinates の読み込みに失敗:", error)
    }
    return cached
  }

  async save(coords: StationCoordinates): Promise<void> {
    const res = await fetch("/api/shared-data", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
      body: JSON.stringify({ action: "save", dataType: "station-coordinates", data: coords }),
    })
    const result = await res.json().catch(() => null)
    if (!res.ok || !result?.success) {
      throw new Error(result?.error || "駅座標の保存に失敗しました")
    }
    cached = { ...coords }
  }
}

export const stationCoordinateManager = new StationCoordinateManager()
