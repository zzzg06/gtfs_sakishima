import { adminAuthHeaders } from "./admin-session"

export interface TripDelayInfo {
  tripId: string
  delayMinutes: number // 遅延時間（分）正の値は遅延、負の値は早着
  status: "on-time" | "delayed" | "early" | "cancelled" // 運行状況
  lastUpdated: string // 最終更新時刻
  reason?: string // 遅延理由
}

export interface TripOperationStatus {
  tripId: string
  isOperating: boolean // 運行中かどうか
  delayInfo?: TripDelayInfo
  statusMessage?: string // 状況メッセージ
}

// 運用表示設定のメモリキャッシュ。
// route-finderなど同期処理から参照するため、loadTripVisibilitySettings()で
// サーバーから読み込んだ最新値を保持する。
let cachedVisibilitySettings: Record<string, boolean> = {}

export function getCachedTripVisibilitySettings(): Record<string, boolean> {
  return cachedVisibilitySettings
}

// 遅延・運行状況・運用表示設定の保存・取得（サーバーAPI一本化）
export class DelayManager {
  private async saveToServer(
    dataType: "delay-info" | "operation-status" | "trip-visibility",
    data: any,
  ): Promise<void> {
    const response = await fetch("/api/shared-data", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
      body: JSON.stringify({ action: "save", dataType, data }),
    })

    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.success) {
      throw new Error(result?.error || `${dataType} の保存に失敗しました`)
    }
    console.log(`[gtfs] ${dataType} saved to server`)
  }

  private async loadFromServer(dataType: "delay-info" | "operation-status" | "trip-visibility"): Promise<any | null> {
    try {
      const response = await fetch(`/api/shared-data?type=${dataType}`)
      const result = await response.json()
      if (result.success) {
        return result.data
      }
    } catch (error) {
      console.error(`[gtfs] Failed to load ${dataType} from server:`, error)
    }
    return null
  }

  async saveDelayInfo(delays: TripDelayInfo[]): Promise<void> {
    await this.saveToServer("delay-info", delays)
  }

  async loadDelayInfo(): Promise<TripDelayInfo[]> {
    const serverData = await this.loadFromServer("delay-info")
    return Array.isArray(serverData) ? serverData : []
  }

  async saveOperationStatus(statuses: TripOperationStatus[]): Promise<void> {
    await this.saveToServer("operation-status", statuses)
  }

  async loadOperationStatus(): Promise<TripOperationStatus[]> {
    const serverData = await this.loadFromServer("operation-status")
    return Array.isArray(serverData) ? serverData : []
  }

  async getDelayInfoForTrip(tripId: string): Promise<TripDelayInfo | null> {
    const delays = await this.loadDelayInfo()
    const existingDelay = delays.find((d) => d.tripId === tripId)

    // 既存の遅延情報がない場合はデフォルトを返す
    if (!existingDelay) {
      return this.getDefaultDelayInfo(tripId)
    }

    return existingDelay
  }

  async getOperationStatusForTrip(tripId: string): Promise<TripOperationStatus | null> {
    const statuses = await this.loadOperationStatus()
    return statuses.find((s) => s.tripId === tripId) || null
  }

  async updateDelayInfo(
    tripId: string,
    delayMinutes: number,
    status: TripDelayInfo["status"],
    reason?: string,
  ): Promise<void> {
    const delays = await this.loadDelayInfo()
    const existingIndex = delays.findIndex((d) => d.tripId === tripId)

    const delayInfo: TripDelayInfo = {
      tripId,
      delayMinutes,
      status,
      lastUpdated: new Date().toISOString(),
      reason,
    }

    if (existingIndex >= 0) {
      delays[existingIndex] = delayInfo
    } else {
      delays.push(delayInfo)
    }

    await this.saveDelayInfo(delays)
  }

  async updateOperationStatus(tripId: string, isOperating: boolean, statusMessage?: string): Promise<void> {
    const statuses = await this.loadOperationStatus()
    const existingIndex = statuses.findIndex((s) => s.tripId === tripId)
    const delayInfo = await this.getDelayInfoForTrip(tripId)

    const operationStatus: TripOperationStatus = {
      tripId,
      isOperating,
      delayInfo: delayInfo || undefined,
      statusMessage,
    }

    if (existingIndex >= 0) {
      statuses[existingIndex] = operationStatus
    } else {
      statuses.push(operationStatus)
    }

    await this.saveOperationStatus(statuses)
  }

  async removeDelayInfo(tripId: string): Promise<void> {
    const delays = await this.loadDelayInfo()
    const filteredDelays = delays.filter((d) => d.tripId !== tripId)
    await this.saveDelayInfo(filteredDelays)
  }

  async removeOperationStatus(tripId: string): Promise<void> {
    const statuses = await this.loadOperationStatus()
    const filteredStatuses = statuses.filter((s) => s.tripId !== tripId)
    await this.saveOperationStatus(filteredStatuses)
  }

  async getDelayStatistics(): Promise<{
    totalTrips: number
    onTimeTrips: number
    delayedTrips: number
    cancelledTrips: number
    averageDelay: number
  }> {
    const delays = await this.loadDelayInfo()
    const totalTrips = delays.length
    const onTimeTrips = delays.filter((d) => d.status === "on-time").length
    const delayedTrips = delays.filter((d) => d.status === "delayed").length
    const cancelledTrips = delays.filter((d) => d.status === "cancelled").length
    const averageDelay = totalTrips > 0 ? delays.reduce((sum, d) => sum + d.delayMinutes, 0) / totalTrips : 0

    return {
      totalTrips,
      onTimeTrips,
      delayedTrips,
      cancelledTrips,
      averageDelay: Math.round(averageDelay * 10) / 10,
    }
  }

  generateStatusMessage(delayInfo: TripDelayInfo): string {
    switch (delayInfo.status) {
      case "on-time":
        return "定刻運行中"
      case "delayed":
        return `約${delayInfo.delayMinutes}分遅れ${delayInfo.reason ? ` (${delayInfo.reason})` : ""}`
      // 早着は扱わない（定刻表示）
      case "early":
        return "定刻運行中"
      case "cancelled":
        return `運休${delayInfo.reason ? ` (${delayInfo.reason})` : ""}`
      default:
        return "運行状況不明"
    }
  }

  getDefaultDelayInfo(tripId: string): TripDelayInfo {
    // 運用管理画面での表示設定を確認（キャッシュ参照）
    const isVisible = cachedVisibilitySettings[tripId] !== false

    return {
      tripId,
      delayMinutes: 0,
      status: isVisible ? "on-time" : "cancelled", // 運行中チェックが外れている場合は運休
      lastUpdated: new Date().toISOString(),
      reason: isVisible ? undefined : "運行管理により運休",
    }
  }

  async saveTripVisibilitySettings(settings: Record<string, boolean>): Promise<void> {
    await this.saveToServer("trip-visibility", settings)
    cachedVisibilitySettings = settings
  }

  async loadTripVisibilitySettings(): Promise<Record<string, boolean>> {
    const serverData = await this.loadFromServer("trip-visibility")
    if (serverData && typeof serverData === "object") {
      cachedVisibilitySettings = serverData
      return serverData
    }
    return cachedVisibilitySettings
  }
}

export const delayManager = new DelayManager()
