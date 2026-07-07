import { adminAuthHeaders } from "./admin-session"

export interface Vehicle {
  id: string
  name: string // 車両名（例：「1001号車」「新型車両A」）
  type: string // 車両タイプ（例：「電車」「バス」「特急」）
  capacity?: number // 定員
  description?: string // 説明
  color?: string // 車両カラー（表示用）
  iconUrl?: string // 車両アイコン画像のURL
}

// 車両の割り当ては「運用（trip_short_name）」単位。1運用＝複数列車・複数サイクルにまとめて適用される。
export interface OperationVehicleAssignment {
  operationId: string // 運用番号（trip_short_name）
  vehicleId: string
}

// レンダリング（route-results等）から同期参照するためのモジュールキャッシュ
let cachedVehicles: Map<string, Vehicle> = new Map()
let cachedAssignments: Map<string, string> = new Map() // operationId -> vehicleId

// 車両データの保存・取得（サーバーAPI一本化）
class VehicleManager {
  private async saveToServer(dataType: "vehicles" | "vehicle-assignments", data: any): Promise<void> {
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

  private async loadFromServer(dataType: "vehicles" | "vehicle-assignments"): Promise<any[]> {
    try {
      const response = await fetch(`/api/shared-data?type=${dataType}`)
      const result = await response.json()
      if (result.success && Array.isArray(result.data)) {
        return result.data
      }
    } catch (error) {
      console.error(`[gtfs] Failed to load ${dataType} from server:`, error)
    }
    return []
  }

  // 車両データの保存
  async saveVehicles(vehicles: Vehicle[]): Promise<void> {
    await this.saveToServer("vehicles", vehicles)
  }

  // 車両データの読み込み
  async loadVehicles(): Promise<Vehicle[]> {
    return this.loadFromServer("vehicles")
  }

  // 運用-車両関連付けデータの保存
  async saveAssignments(assignments: OperationVehicleAssignment[]): Promise<void> {
    await this.saveToServer("vehicle-assignments", assignments)
  }

  // 運用-車両関連付けデータの読み込み（旧形式 {tripId} も operationId として読む）
  async loadAssignments(): Promise<OperationVehicleAssignment[]> {
    const raw = await this.loadFromServer("vehicle-assignments")
    return raw
      .map((a: any) => ({ operationId: a.operationId ?? a.tripId, vehicleId: a.vehicleId }))
      .filter((a: OperationVehicleAssignment) => a.operationId && a.vehicleId)
  }

  // 車両・割り当てをキャッシュへ読み込む（検索前や管理画面表示時に呼ぶ）
  async loadCache(): Promise<{ vehicles: Vehicle[]; assignments: OperationVehicleAssignment[] }> {
    const [vehicles, assignments] = await Promise.all([this.loadVehicles(), this.loadAssignments()])
    cachedVehicles = new Map(vehicles.map((v) => [v.id, v]))
    cachedAssignments = new Map(assignments.map((a) => [a.operationId, a.vehicleId]))
    return { vehicles, assignments }
  }

  // 運用番号から割り当て車両を同期取得（キャッシュ参照）
  getCachedVehicleForOperation(operationId?: string): Vehicle | null {
    if (!operationId) return null
    const vid = cachedAssignments.get(operationId)
    if (!vid) return null
    return cachedVehicles.get(vid) || null
  }

  private createId(): string {
    return `vehicle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // 車両を追加
  async addVehicle(vehicle: Omit<Vehicle, "id">): Promise<Vehicle> {
    const vehicles = await this.loadVehicles()
    const newVehicle: Vehicle = { ...vehicle, id: this.createId() }
    vehicles.push(newVehicle)
    await this.saveVehicles(vehicles)
    return newVehicle
  }

  // 車両を一括追加（Excel/CSVインポート用）
  async addVehicles(newVehicles: Omit<Vehicle, "id">[]): Promise<Vehicle[]> {
    const vehicles = await this.loadVehicles()
    const added = newVehicles.map((v) => ({ ...v, id: this.createId() }))
    await this.saveVehicles([...vehicles, ...added])
    return added
  }

  // 車両を更新
  async updateVehicle(vehicleId: string, updates: Partial<Omit<Vehicle, "id">>): Promise<boolean> {
    const vehicles = await this.loadVehicles()
    const index = vehicles.findIndex((v) => v.id === vehicleId)
    if (index === -1) return false

    vehicles[index] = { ...vehicles[index], ...updates }
    await this.saveVehicles(vehicles)
    return true
  }

  // 車両を削除
  async deleteVehicle(vehicleId: string): Promise<boolean> {
    const vehicles = await this.loadVehicles()
    const filteredVehicles = vehicles.filter((v) => v.id !== vehicleId)
    if (filteredVehicles.length === vehicles.length) return false

    await this.saveVehicles(filteredVehicles)

    // 関連する運用-車両関連付けも削除
    const assignments = await this.loadAssignments()
    const filteredAssignments = assignments.filter((a) => a.vehicleId !== vehicleId)
    await this.saveAssignments(filteredAssignments)
    cachedVehicles.delete(vehicleId)
    for (const [op, vid] of cachedAssignments) if (vid === vehicleId) cachedAssignments.delete(op)

    return true
  }

  private assignmentsFromCache(): OperationVehicleAssignment[] {
    return [...cachedAssignments.entries()].map(([operationId, vehicleId]) => ({ operationId, vehicleId }))
  }

  // 運用（trip_short_name）に車両を関連付け（その運用の全列車・全サイクルに適用）。
  // キャッシュを真実として保存するため、連続で割り当てても取りこぼさない（要：事前にloadCache）。
  async assignVehicleToOperation(operationId: string, vehicleId: string): Promise<void> {
    cachedAssignments.set(operationId, vehicleId)
    await this.saveAssignments(this.assignmentsFromCache())
  }

  // 運用の車両関連付けを削除
  async removeVehicleFromOperation(operationId: string): Promise<void> {
    cachedAssignments.delete(operationId)
    await this.saveAssignments(this.assignmentsFromCache())
  }

  // 車両タイプの一覧を取得
  async getVehicleTypes(): Promise<string[]> {
    const vehicles = await this.loadVehicles()
    const types = new Set(vehicles.map((v) => v.type))
    return Array.from(types).sort()
  }
}

export const vehicleManager = new VehicleManager()
