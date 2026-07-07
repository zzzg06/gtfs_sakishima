import { type NextRequest, NextResponse } from "next/server"
import type { Vehicle, OperationVehicleAssignment } from "@/lib/vehicle-manager"
import type { TripDelayInfo, TripOperationStatus } from "@/lib/delay-manager"
import { DEFAULT_ROUTE_SETTINGS, type RouteSettings } from "@/lib/route-settings"
import type { StationCoordinates } from "@/lib/station-coordinates"
import { readJsonFile, writeJsonFile } from "@/lib/server/file-store"
import { getRequestSession } from "@/lib/server/session"

// 共有データAPI（車両・運用割当・遅延・運行状況・運用表示設定）
//
// data/runtime/shared-data.json にファイル保存される。書き込み不可の環境では
// メモリ保持（インスタンス再起動で初期化）。参照は誰でも可、更新は管理者認証必須。

interface SharedDataStore {
  vehicles: Vehicle[]
  vehicleAssignments: OperationVehicleAssignment[]
  delayInfo: TripDelayInfo[]
  operationStatus: TripOperationStatus[]
  tripVisibilitySettings: Record<string, boolean>
  routeSettings: RouteSettings
  stationCoordinates: StationCoordinates
  lastUpdated: string
}

const STATE_FILE = "shared-data.json"

function emptyStore(): SharedDataStore {
  return {
    vehicles: [],
    vehicleAssignments: [],
    delayInfo: [],
    operationStatus: [],
    tripVisibilitySettings: {},
    routeSettings: { ...DEFAULT_ROUTE_SETTINGS },
    stationCoordinates: {},
    lastUpdated: new Date().toISOString(),
  }
}

let memoryStore: SharedDataStore | null = null

async function loadStore(): Promise<SharedDataStore> {
  if (!memoryStore) {
    const saved = await readJsonFile<Partial<SharedDataStore>>(STATE_FILE)
    // 既存ファイルに新フィールドが無い場合に備えてデフォルトとマージ
    memoryStore = { ...emptyStore(), ...(saved || {}) }
  }
  return memoryStore
}

async function saveStore(store: SharedDataStore): Promise<void> {
  store.lastUpdated = new Date().toISOString()
  memoryStore = store
  await writeJsonFile(STATE_FILE, store)
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const dataType = searchParams.get("type")

  try {
    const store = await loadStore()

    switch (dataType) {
      case "vehicles":
        return NextResponse.json({ success: true, data: store.vehicles, lastUpdated: store.lastUpdated })

      case "vehicle-assignments":
        return NextResponse.json({ success: true, data: store.vehicleAssignments, lastUpdated: store.lastUpdated })

      case "delay-info":
        return NextResponse.json({ success: true, data: store.delayInfo, lastUpdated: store.lastUpdated })

      case "operation-status":
        return NextResponse.json({ success: true, data: store.operationStatus, lastUpdated: store.lastUpdated })

      case "trip-visibility":
        return NextResponse.json({ success: true, data: store.tripVisibilitySettings, lastUpdated: store.lastUpdated })

      case "route-settings":
        return NextResponse.json({ success: true, data: store.routeSettings, lastUpdated: store.lastUpdated })

      case "station-coordinates":
        return NextResponse.json({ success: true, data: store.stationCoordinates, lastUpdated: store.lastUpdated })

      case "all":
        return NextResponse.json({ success: true, data: store, lastUpdated: store.lastUpdated })

      default:
        return NextResponse.json({ success: false, error: "Invalid data type" }, { status: 400 })
    }
  } catch (error) {
    console.error("[gtfs] Shared data GET error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, dataType, data } = body

    // 更新系は管理者認証必須
    if (!getRequestSession(request, body)) {
      return NextResponse.json({ success: false, error: "管理者認証が必要です" }, { status: 401 })
    }

    const store = await loadStore()

    switch (action) {
      case "save":
        switch (dataType) {
          case "vehicles":
            store.vehicles = data
            break
          case "vehicle-assignments":
            store.vehicleAssignments = data
            break
          case "delay-info":
            store.delayInfo = data
            break
          case "operation-status":
            store.operationStatus = data
            break
          case "trip-visibility":
            store.tripVisibilitySettings = data
            break
          case "route-settings":
            store.routeSettings = { ...DEFAULT_ROUTE_SETTINGS, ...data }
            break
          case "station-coordinates":
            store.stationCoordinates = data || {}
            break
          default:
            return NextResponse.json({ success: false, error: "Invalid data type" }, { status: 400 })
        }

        await saveStore(store)
        console.log(`[gtfs] Shared data saved: ${dataType}`)
        return NextResponse.json({
          success: true,
          message: `${dataType} data saved successfully`,
          lastUpdated: store.lastUpdated,
        })

      case "sync":
        // 複数のデータタイプを一度に同期
        if (data.vehicles) store.vehicles = data.vehicles
        if (data.vehicleAssignments) store.vehicleAssignments = data.vehicleAssignments
        if (data.delayInfo) store.delayInfo = data.delayInfo
        if (data.operationStatus) store.operationStatus = data.operationStatus
        if (data.tripVisibilitySettings) store.tripVisibilitySettings = data.tripVisibilitySettings

        await saveStore(store)
        console.log("[gtfs] Shared data synced")
        return NextResponse.json({ success: true, message: "Data synced successfully", lastUpdated: store.lastUpdated })

      case "clear": {
        let next = store
        if (dataType === "all") {
          next = emptyStore()
        } else {
          switch (dataType) {
            case "vehicles":
              next.vehicles = []
              break
            case "vehicle-assignments":
              next.vehicleAssignments = []
              break
            case "delay-info":
              next.delayInfo = []
              break
            case "operation-status":
              next.operationStatus = []
              break
            case "trip-visibility":
              next.tripVisibilitySettings = {}
              break
            case "station-coordinates":
              next.stationCoordinates = {}
              break
          }
        }

        await saveStore(next)
        return NextResponse.json({
          success: true,
          message: `${dataType} data cleared successfully`,
          lastUpdated: next.lastUpdated,
        })
      }

      default:
        return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 })
    }
  } catch (error) {
    console.error("[gtfs] Shared data POST error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
