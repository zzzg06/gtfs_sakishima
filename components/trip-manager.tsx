"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Train, Bus, Eye, EyeOff, Calendar, Settings, Save, ArrowLeft, Car } from "lucide-react"
import { gtfsParser, type GTFSTrip, type GTFSRoute, type GTFSCalendar } from "@/lib/gtfs-parser"
import { vehicleManager, type Vehicle } from "@/lib/vehicle-manager"
import { delayManager } from "@/lib/delay-manager"

interface TripWithDetails extends GTFSTrip {
  route: GTFSRoute
  calendar: GTFSCalendar
  isActive: boolean
  isVisible: boolean
  assignedVehicle?: Vehicle
}

interface TripGroup {
  tripShortName: string
  trips: TripWithDetails[]
  isVisible: boolean
  hasActiveTrips: boolean
}

interface TripManagerProps {
  onVisibilityChange: () => void
  onBack: () => void
  onShowVehicleManager?: () => void
}

export function TripManager({ onBack, onShowVehicleManager }: TripManagerProps) {
  const [trips, setTrips] = useState<TripWithDetails[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [visibilitySettings, setVisibilitySettings] = useState<Record<string, boolean>>({})
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [selectedOperation, setSelectedOperation] = useState<string>("")

  useEffect(() => {
    loadTrips()
  }, [])

  const loadTrips = async () => {
    setIsLoading(true)
    try {
      if (!gtfsParser.hasData()) await gtfsParser.loadFromStorageAsync()

      const allTrips = gtfsParser.getTrips()
      const allRoutes = gtfsParser.getRoutes()
      const allCalendar = gtfsParser.getCalendar()
      const settings = await delayManager.loadTripVisibilitySettings()
      const { vehicles: loadedVehicles } = await vehicleManager.loadCache()
      setVehicles(Array.isArray(loadedVehicles) ? loadedVehicles : [])

      const tripsWithDetails: TripWithDetails[] = allTrips
        .map((trip) => {
          const route = allRoutes.find((r) => r.route_id === trip.route_id)
          const calendar = allCalendar.find((c) => c.service_id === trip.service_id)
          if (!route || !calendar) return null
          return {
            ...trip,
            route,
            calendar,
            isActive: isServiceActive(calendar),
            isVisible: settings[trip.trip_id] !== false,
            assignedVehicle: vehicleManager.getCachedVehicleForOperation(trip.trip_short_name) || undefined,
          }
        })
        .filter((t): t is TripWithDetails => t !== null)

      setTrips(tripsWithDetails)
      setVisibilitySettings(settings)
    } catch (error) {
      console.error("[gtfs] 運用データの読み込みに失敗:", error)
    } finally {
      setIsLoading(false)
    }
  }

  // 車両は運用（trip_short_name）単位で割り当て。その運用の全列車・全サイクルにまとめて適用される。
  const handleVehicleAssignment = (operationId: string, vehicleId: string) => {
    if (vehicleId === "none") vehicleManager.removeVehicleFromOperation(operationId)
    else vehicleManager.assignVehicleToOperation(operationId, vehicleId)
    const assignedVehicle = vehicleId === "none" ? undefined : vehicles.find((v) => v.id === vehicleId)
    setTrips(trips.map((t) => (t.trip_short_name === operationId ? { ...t, assignedVehicle } : t)))
  }

  const isServiceActive = (calendar?: GTFSCalendar): boolean => {
    if (!calendar) return false
    const today = new Date()
    const currentDate = today.toISOString().slice(0, 10).replace(/-/g, "")
    const dayOfWeek = today.getDay()
    if (currentDate < calendar.start_date || currentDate > calendar.end_date) return false
    const dayFlags = [
      calendar.sunday,
      calendar.monday,
      calendar.tuesday,
      calendar.wednesday,
      calendar.thursday,
      calendar.friday,
      calendar.saturday,
    ]
    return dayFlags[dayOfWeek] === 1
  }

  const handleVisibilityChange = (tripId: string, visible: boolean) => {
    setVisibilitySettings({ ...visibilitySettings, [tripId]: visible })
    setHasUnsavedChanges(true)
    setTrips(trips.map((t) => (t.trip_id === tripId ? { ...t, isVisible: visible } : t)))
  }

  const handleGroupVisibilityChange = (tripShortName: string, visible: boolean) => {
    const newSettings = { ...visibilitySettings }
    trips.filter((t) => t.trip_short_name === tripShortName).forEach((t) => (newSettings[t.trip_id] = visible))
    setVisibilitySettings(newSettings)
    setHasUnsavedChanges(true)
    setTrips(trips.map((t) => (t.trip_short_name === tripShortName ? { ...t, isVisible: visible } : t)))
  }

  const handleSave = async () => {
    try {
      await delayManager.saveTripVisibilitySettings(visibilitySettings)
      setHasUnsavedChanges(false)
    } catch (error) {
      console.error("[gtfs] 運用表示設定の保存に失敗:", error)
      alert("運用表示設定の保存に失敗しました。ログイン状態を確認してください。")
    }
  }

  const tripGroups = useMemo<TripGroup[]>(() => {
    const groupMap = new Map<string, TripWithDetails[]>()
    trips.forEach((trip) => {
      const key = trip.trip_short_name || "未設定"
      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)!.push(trip)
    })
    return Array.from(groupMap.entries())
      .map(([tripShortName, groupTrips]) => ({
        tripShortName,
        trips: groupTrips,
        isVisible: groupTrips.every((t) => t.isVisible),
        hasActiveTrips: groupTrips.some((t) => t.isActive),
      }))
      .sort((a, b) => a.tripShortName.localeCompare(b.tripShortName, "ja", { numeric: true }))
  }, [trips])

  // 初期/再読込時は先頭の運用を選択
  useEffect(() => {
    if (tripGroups.length > 0 && !tripGroups.some((g) => g.tripShortName === selectedOperation)) {
      setSelectedOperation(tripGroups[0].tripShortName)
    }
  }, [tripGroups, selectedOperation])

  // 車両画像が未設定のときの既定アイコン（車両タイプは廃止）
  const getVehicleIcon = () => <Train className="h-3.5 w-3.5" />

  const getRouteColor = (route: GTFSRoute) => {
    if (!route) return "#6b7280"
    if (route.route_color && route.route_color.length === 6) return `#${route.route_color}`
    return route.route_type === 3 ? "#10b981" : "#3b82f6"
  }

  const formatDepartureTime = (time?: string): string => {
    if (!time) return "—"
    const [h, m] = time.split(":")
    return `${Number.parseInt(h)}:${m}`
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Settings className="mx-auto mb-4 h-12 w-12 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">運用データを読み込み中...</p>
        </CardContent>
      </Card>
    )
  }

  if (trips.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Train className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-semibold">運用データがありません</h3>
          <p className="text-muted-foreground">GTFSデータをアップロードしてください。</p>
        </CardContent>
      </Card>
    )
  }

  const group = tripGroups.find((g) => g.tripShortName === selectedOperation) || null
  const visibleCount = trips.filter((t) => t.isVisible).length
  const assignedVehicleId = group?.trips.find((t) => t.assignedVehicle)?.assignedVehicle?.id || "none"

  return (
    <div className="space-y-6">
      {hasUnsavedChanges && (
        <Alert className="border-orange-200 bg-orange-50">
          <Save className="h-4 w-4" />
          <AlertDescription>変更が保存されていません。「保存」で確定してください。</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            戻る
          </Button>
          <div>
            <h2 className="text-2xl font-bold">運用管理</h2>
            <p className="text-muted-foreground">
              運用を選択して管理（{tripGroups.length}運用 / {visibleCount}/{trips.length}便表示中）
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {onShowVehicleManager && (
            <Button variant="outline" size="sm" onClick={onShowVehicleManager}>
              <Car className="mr-1 h-4 w-4" />
              車両管理
            </Button>
          )}
          {hasUnsavedChanges && (
            <Button onClick={handleSave} className="bg-green-600 hover:bg-green-700">
              <Save className="mr-1 h-4 w-4" />
              保存
            </Button>
          )}
        </div>
      </div>

      {/* 運用セレクタ */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
        <span className="text-sm font-medium text-muted-foreground">運用番号</span>
        <Select value={selectedOperation} onValueChange={setSelectedOperation}>
          <SelectTrigger className="h-9 w-48">
            <SelectValue placeholder="運用を選択" />
          </SelectTrigger>
          <SelectContent>
            {tripGroups.map((g) => (
              <SelectItem key={g.tripShortName} value={g.tripShortName}>
                {g.tripShortName}（{g.trips.length}便{g.hasActiveTrips ? "・運行" : ""}）
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {group && (
        <Card className={group.hasActiveTrips ? "border-green-200" : "border-gray-200"}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Badge className={group.hasActiveTrips ? "bg-green-600" : "bg-gray-500"}>{group.tripShortName}</Badge>
                <span className="text-sm text-muted-foreground">
                  {group.trips.length}便（{group.trips.filter((t) => t.isActive).length}運行中）
                </span>
              </div>
              <div className="flex items-center gap-3">
                {/* 運用全体の車両割り当て */}
                <span className="text-xs text-muted-foreground">使用車両</span>
                <Select value={assignedVehicleId} onValueChange={(v) => handleVehicleAssignment(group.tripShortName, v)}>
                  <SelectTrigger className="h-8 w-44 text-xs">
                    <SelectValue placeholder="車両選択" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">車両なし</SelectItem>
                    {vehicles.map((vehicle) => (
                      <SelectItem key={vehicle.id} value={vehicle.id}>
                        <div className="flex items-center gap-1.5">
                          {vehicle.iconUrl ? (
                            <img src={vehicle.iconUrl} alt="" className="h-4 w-auto object-contain" />
                          ) : (
                            getVehicleIcon()
                          )}
                          {vehicle.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">一括表示</span>
                  <Checkbox
                    checked={group.isVisible}
                    onCheckedChange={(checked) => handleGroupVisibilityChange(group.tripShortName, checked as boolean)}
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid gap-2">
              {group.trips.map((trip) => {
                const RouteIcon = trip.route.route_type === 3 ? Bus : Train
                const color = getRouteColor(trip.route)
                const dep = gtfsParser.getFirstDepartureTimeForTrip?.(trip.trip_id)
                return (
                  <div
                    key={trip.trip_id}
                    className="flex items-center justify-between rounded border bg-white/50 p-2"
                  >
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <RouteIcon className="h-4 w-4" style={{ color }} />
                      <span className="text-sm font-medium">
                        {trip.route.route_short_name || trip.route.route_long_name}
                      </span>
                      {trip.train_number && (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                          列車番号 {trip.train_number}
                        </span>
                      )}
                      {trip.trip_headsign && (
                        <span className="text-xs text-muted-foreground">→ {trip.trip_headsign}</span>
                      )}
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-xs text-blue-600">
                        {formatDepartureTime(dep)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={trip.isVisible && trip.isActive ? "default" : "secondary"} className="text-xs">
                        {trip.isVisible && trip.isActive ? "運行中" : "運休中"}
                      </Badge>
                      <Checkbox
                        checked={trip.isVisible}
                        onCheckedChange={(checked) => handleVisibilityChange(trip.trip_id, checked as boolean)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Alert>
        <Calendar className="h-4 w-4" />
        <AlertDescription>
          運行状況は現在の日付とカレンダー設定に基づきます。チェックボックスで検索結果への表示/非表示を制御できます。
          車両は運用単位で割り当てられ、走行位置のアイコンに反映されます。遅延はDynmap実位置から自動推定されます（手入力は廃止）。
        </AlertDescription>
      </Alert>
    </div>
  )
}
