import type { GTFSStop, GTFSRoute, GTFSTrip, GTFSStopTime, GTFSCalendar } from "./gtfs-parser"
import { adminAuthHeaders } from "./admin-session"

export interface GTFSDataset {
  id: string
  name: string
  uploadDate: string
  stops: GTFSStop[]
  routes: GTFSRoute[]
  trips: GTFSTrip[]
  stopTimes: GTFSStopTime[]
  calendar: GTFSCalendar[]
}

// GTFSデータセットの保存・取得（サーバーAPI一本化）
// ダイヤデータはサーバーに同梱されているため、クライアント側のフォールバック保存は持たない
export class GTFSStorage {
  static async saveDataset(dataset: GTFSDataset): Promise<void> {
    const response = await fetch("/api/gtfs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...adminAuthHeaders(),
      },
      body: JSON.stringify({
        action: "save",
        dataset,
      }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(data?.error || "サーバーへの保存に失敗しました")
    }

    console.log("[gtfs] GTFSデータセットをサーバーに保存しました:", dataset.name)
  }

  static async getAllDatasets(): Promise<GTFSDataset[]> {
    try {
      const response = await fetch("/api/gtfs?action=list")
      if (response.ok) {
        const data = await response.json()
        return data.datasets || []
      }
    } catch (error) {
      console.error("[gtfs] サーバーからの取得に失敗:", error)
    }
    return []
  }

  static async getActiveDataset(): Promise<GTFSDataset | null> {
    try {
      const response = await fetch("/api/gtfs?action=active")
      if (response.ok) {
        const data = await response.json()
        return data.dataset || null
      }
    } catch (error) {
      console.error("[gtfs] アクティブデータセットの取得に失敗:", error)
    }
    return null
  }

  static async setActiveDataset(datasetId: string): Promise<void> {
    const response = await fetch("/api/gtfs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...adminAuthHeaders(),
      },
      body: JSON.stringify({
        action: "setActive",
        datasetId,
      }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(data?.error || "アクティブデータセットの設定に失敗しました")
    }
  }

  static async deleteDataset(datasetId: string): Promise<void> {
    const response = await fetch("/api/gtfs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...adminAuthHeaders(),
      },
      body: JSON.stringify({
        action: "delete",
        datasetId,
      }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(data?.error || "データセットの削除に失敗しました")
    }

    console.log("[gtfs] GTFSデータセットを削除しました:", datasetId)
  }

  static async hasData(): Promise<boolean> {
    const activeDataset = await this.getActiveDataset()
    return activeDataset !== null
  }

  static async clearAllData(): Promise<void> {
    // 同梱データセットは削除できないため、アップロード分のみ削除される
    const datasets = await this.getAllDatasets()
    for (const dataset of datasets) {
      try {
        await this.deleteDataset(dataset.id)
      } catch (error) {
        console.warn("[gtfs] データセット削除をスキップ:", dataset.id, error)
      }
    }
  }
}
