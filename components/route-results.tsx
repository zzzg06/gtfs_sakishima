"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Clock, RefreshCw, AlertCircle, Train, Bus, Search, Circle, Car, ChevronLeft, ChevronRight, Send, CheckCircle2, Navigation } from "lucide-react"
import type { TransitRoute, TransitSegment, WalkingSegment, RouteBadge } from "@/lib/route-finder"
import type { RouteQuery } from "@/hooks/use-route-search"
import { vehicleManager } from "@/lib/vehicle-manager"
import { gtfsParser, type GTFSStop } from "@/lib/gtfs-parser"
import { computeTrainRunStates, nowMinutesInTokyo } from "@/lib/train-position"
import { delayManager, getCachedTripVisibilitySettings } from "@/lib/delay-manager"
import { sendOperationRequest } from "@/lib/operation-request"

interface RouteResultsProps {
  routes: TransitRoute[]
  isLoading: boolean
  error: string | null
  hasSearched: boolean
  query?: RouteQuery | null
  canEarlier?: boolean
  canLater?: boolean
  onEarlier?: () => void
  onLater?: () => void
  onNewSearch: () => void
  onStationClick?: (stop: GTFSStop) => void // 駅名クリックで時刻表へ
}

// 検索条件のヘッダー（出発地→到着地・日時・1本前/1本後）
function ResultHeader({
  query,
  canEarlier,
  canLater,
  onEarlier,
  onLater,
  onNewSearch,
}: {
  query?: RouteQuery | null
  canEarlier?: boolean
  canLater?: boolean
  onEarlier?: () => void
  onLater?: () => void
  onNewSearch: () => void
}) {
  const now = new Date()
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][now.getDay()]
  const dateStr = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, "0")}月${String(now.getDate()).padStart(2, "0")}日(${weekday})`
  const modeLabel = query?.mode === "arrival" ? "到着" : query?.mode === "none" ? "（始発から）" : "出発"
  const timeLabel = query && query.mode !== "none" && query.time ? `${query.time}${modeLabel}` : modeLabel

  return (
    <div className="overflow-hidden rounded-lg border border-border shadow-sm">
      {/* 出発地・到着地・再検索 */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-green-700 px-4 py-2 text-white">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {query && (
            <>
              <span>
                <span className="opacity-80">出発地:</span> <span className="font-bold">{query.fromName}</span>
              </span>
              <span>
                <span className="opacity-80">到着地:</span> <span className="font-bold">{query.toName}</span>
              </span>
            </>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={onNewSearch}
          className="h-7 bg-orange-500 px-3 text-white hover:bg-orange-600"
        >
          <Search className="mr-1 h-3.5 w-3.5" />
          再検索
        </Button>
      </div>

      {/* 1本前 / 日時 / 1本後 */}
      <div className="flex items-center justify-between gap-2 bg-card px-2 py-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onEarlier}
          disabled={!onEarlier || !canEarlier}
          className="h-8 px-2 text-xs"
        >
          <ChevronLeft className="h-4 w-4" />
          1本前
        </Button>
        <div className="text-center text-sm font-semibold text-foreground">
          {dateStr} <span className="text-green-700">{timeLabel}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onLater}
          disabled={!onLater || !canLater}
          className="h-8 px-2 text-xs"
        >
          1本後
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// 現在（実時間）走行中の運用番号の集合を分単位でキャッシュして返す。
// 各検索結果カードから呼ばれるため、毎回 computeTrainRunStates しないようにする。
let _runningOpsCache: { min: number; set: Set<string> } | null = null
function getRunningOps(): Set<string> {
  if (!gtfsParser.hasData()) return new Set<string>()
  const min = Math.floor(nowMinutesInTokyo())
  if (_runningOpsCache && _runningOpsCache.min === min) return _runningOpsCache.set
  const stopNameById = new Map<string, string>()
  for (const s of gtfsParser.getStops()) if (!stopNameById.has(s.stop_id)) stopNameById.set(s.stop_id, s.stop_name)
  const states = computeTrainRunStates({
    trips: gtfsParser.getTrips(),
    stopTimes: gtfsParser.getAllStopTimes(),
    routes: gtfsParser.getRoutes(),
    stopNameById,
    delaysByTripId: new Map(),
    visibilityByTripId: getCachedTripVisibilitySettings(),
    nowMinutes: min,
  })
  const set = new Set(states.map((s) => s.operationId))
  _runningOpsCache = { min, set }
  return set
}

export function RouteResults({
  routes,
  isLoading,
  error,
  hasSearched,
  query,
  canEarlier,
  canLater,
  onEarlier,
  onLater,
  onNewSearch,
  onStationClick,
}: RouteResultsProps) {
  if (!hasSearched && !isLoading) {
    return null
  }

  if (isLoading) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="p-8">
          <div className="flex items-center justify-center space-x-3">
            <RefreshCw className="h-5 w-5 animate-spin text-primary" />
            <p className="text-foreground">経路を検索しています...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="p-8">
          <div className="flex items-center justify-center space-x-3 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p>{error}</p>
          </div>
          <div className="mt-4 text-center">
            <Button variant="outline" onClick={onNewSearch}>
              再検索
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (routes.length === 0) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="p-8">
          <div className="text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
            <div>
              <h3 className="text-lg font-semibold text-foreground">経路が見つかりませんでした</h3>
              <p className="text-muted-foreground mt-2">
                指定された条件では経路が見つかりません。駅名や時刻を変更してもう一度お試しください。
              </p>
            </div>
            <Button variant="outline" onClick={onNewSearch}>
              条件を変更して再検索
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const routeBadges = computeRouteBadges(routes)

  return (
    <div className="w-full space-y-4">
      <ResultHeader
        query={query}
        canEarlier={canEarlier}
        canLater={canLater}
        onEarlier={onEarlier}
        onLater={onLater}
        onNewSearch={onNewSearch}
      />

      {routes.map((route, index) => (
        <RouteCard
          key={`${route.departureTime}-${route.arrivalTime}-${index}`}
          route={route}
          index={index}
          badges={routeBadges[index]}
          onStationClick={onStationClick}
        />
      ))}
    </div>
  )
}

// 表示中の経路の中で 早=最速到着 / 楽=乗換最少 / 短=所要最短 をそれぞれ1件に付与する。
// 同点は先頭（＝到着が早く出発が遅い並び）を採用。1経路が複数バッジを持ってよい。
function computeRouteBadges(routes: TransitRoute[]): RouteBadge[][] {
  const badges: RouteBadge[][] = routes.map(() => [])
  if (routes.length === 0) return badges
  const toMin = (t: string) => {
    const [h, m, s] = t.split(":").map(Number)
    return h * 60 + (m || 0) + (s || 0) / 60
  }
  const argmin = (val: (r: TransitRoute) => number) => {
    let bi = 0
    for (let i = 1; i < routes.length; i++) if (val(routes[i]) < val(routes[bi])) bi = i
    return bi
  }
  badges[argmin((r) => toMin(r.arrivalTime))].push("fast")
  badges[argmin((r) => r.transfers)].push("easy")
  badges[argmin((r) => r.totalDuration)].push("short")
  return badges
}

function RouteCard({
  route,
  index,
  badges = [],
  onStationClick,
}: {
  route: TransitRoute
  index: number
  badges?: RouteBadge[]
  onStationClick?: (stop: GTFSStop) => void
}) {
  // クリックで途中停車駅を展開しているセグメントのインデックス
  const [expandedSegments, setExpandedSegments] = useState<Set<number>>(new Set())

  // 運用リクエスト送信ダイアログ
  const [requestTrip, setRequestTrip] = useState<{
    tripShortName: string
    routeName?: string
    headsign?: string
  } | null>(null)
  const [requestMessage, setRequestMessage] = useState("")
  const [requestState, setRequestState] = useState<"idle" | "sending" | "done" | "error">("idle")
  const [requestError, setRequestError] = useState("")

  // 現在（実時間）走行中の運用番号の集合（分単位キャッシュ）。走行中なら「走行位置」リンクを出す。
  const runningOps = getRunningOps()

  const openRequestDialog = (info: { tripShortName: string; routeName?: string; headsign?: string }) => {
    setRequestTrip(info)
    setRequestMessage("")
    setRequestState("idle")
    setRequestError("")
  }

  const submitRequest = async () => {
    if (!requestTrip) return
    setRequestState("sending")
    setRequestError("")
    try {
      await sendOperationRequest({ ...requestTrip, message: requestMessage.trim() || undefined })
      setRequestState("done")
    } catch (err) {
      setRequestState("error")
      setRequestError(err instanceof Error ? err.message : "送信に失敗しました")
    }
  }

  const toggleSegment = (segmentIndex: number) => {
    setExpandedSegments((prev) => {
      const next = new Set(prev)
      if (next.has(segmentIndex)) {
        next.delete(segmentIndex)
      } else {
        next.add(segmentIndex)
      }
      return next
    })
  }

  // セグメント区間の途中停車駅（乗車駅・降車駅を除く）を時刻順に取得
  const getIntermediateStops = (segment: TransitSegment) => {
    if (isWalkingSegment(segment)) return []
    const stops = gtfsParser
      .getStopTimes()
      .filter((st) => st.trip_id === segment.trip.trip_id)
      .sort((a, b) => a.stop_sequence - b.stop_sequence)
      .filter((st) => st.stop_sequence > segment.stopSequenceFrom && st.stop_sequence < segment.stopSequenceTo)
      .map((st) => ({
        stopId: st.stop_id,
        name: gtfsParser.getStop(st.stop_id)?.stop_name || st.stop_id,
        time: formatTime(st.arrival_time || st.departure_time),
        platform: st.platform_code,
      }))
    // 分岐駅は路線データ上に重複して現れるため、連続する同一駅を1つにまとめる
    return stops.filter((stop, i) => i === 0 || stop.stopId !== stops[i - 1].stopId)
  }

  const formatTime = (timeString: string) => {
    if (timeString.includes(":")) {
      const [hours, minutes] = timeString.split(":")
      const h = Number.parseInt(hours, 10)
      return `${h}:${minutes}`
    }
    return timeString
  }

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = Math.round(minutes % 60)
    if (hours > 0) {
      return `${hours}時間${mins}分`
    }
    return `${mins}分`
  }

  const formatDistance = (meters: number) => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)}km`
    }
    return `${Math.round(meters)}m`
  }

  const calculateWaitTime = (arrivalTime: string, departureTime: string) => {
    const parseTime = (timeStr: string) => {
      const [hours, minutes] = timeStr.split(":").map(Number)
      return hours * 60 + minutes
    }

    const arrivalMinutes = parseTime(arrivalTime)
    const departureMinutes = parseTime(departureTime)
    const waitMinutes = departureMinutes - arrivalMinutes

    return waitMinutes > 0 ? waitMinutes : 0
  }

  const checkDropOffRestriction = (segment: TransitSegment) => {
    // drop_off_type: 0=通常, 1=降車不可, 2=電話予約必要, 3=運転手に要連絡
    const none = { hasDropOffRestriction: false, needsReservation: false, needsDriverContact: false }
    if (isWalkingSegment(segment)) return none

    const stopTime = gtfsParser.getStopTimeForTripAndStop(segment.trip.trip_id, segment.toStop.stop_id)
    const dropOff = stopTime?.drop_off_type
    return {
      hasDropOffRestriction: dropOff === 1,
      needsReservation: dropOff === 2,
      needsDriverContact: dropOff === 3,
    }
  }

  const getPlatformInfo = (tripId: string, stopId: string) => {
    const stopTime = gtfsParser.getStopTimeForTripAndStop(tripId, stopId)
    return stopTime?.platform_code ? `${stopTime.platform_code}番線` : null
  }

  const isWalkingSegment = (segment: TransitSegment): segment is WalkingSegment => {
    return segment.type === "walking"
  }

  const getTransportIcon = (routeType: number) => {
    switch (routeType) {
      case 3: // バス
        return {
          icon: Bus,
          color: "text-green-600",
          bgColor: "bg-green-50",
          label: "バス",
        }
      default: // 電車・その他
        return {
          icon: Train,
          color: "text-primary",
          bgColor: "bg-primary/5",
          label: "電車",
        }
    }
  }

  const getVehicleIcon = (vehicle: any) => {
    // カスタムアイコンがある場合は画像を表示
    if (vehicle.iconUrl) {
      return (
        <img
          src={vehicle.iconUrl || "/placeholder.svg"}
          alt={vehicle.name}
          className="h-4 w-4 object-contain rounded"
          onError={(e) => {
            // 画像読み込みエラー時はデフォルトアイコンにフォールバック
            const target = e.target as HTMLImageElement
            target.style.display = "none"
            target.nextElementSibling?.classList.remove("hidden")
          }}
        />
      )
    }

    // デフォルトアイコン
    const lowerType = (vehicle.type || "").toLowerCase()
    if (lowerType.includes("バス")) return <Bus className="h-4 w-4" />
    if (lowerType.includes("電車") || lowerType.includes("特急")) return <Train className="h-4 w-4" />
    return <Car className="h-4 w-4" />
  }

  const StationIcon = ({ type }: { type: "departure" | "transfer" | "arrival" }) => {
    const getStationStyle = () => {
      switch (type) {
        case "departure":
          return {
            bgColor: "bg-blue-500",
            textColor: "text-white",
            borderColor: "border-blue-600",
          }
        case "transfer":
          return {
            bgColor: "bg-blue-500",
            textColor: "text-white",
            borderColor: "border-blue-600",
          }
        case "arrival":
          return {
            bgColor: "bg-red-500",
            textColor: "text-white",
            borderColor: "border-red-600",
          }
      }
    }

    const style = getStationStyle()
    return (
      <div
        className={`w-6 h-6 rounded-full ${style.bgColor} ${style.borderColor} border-2 border-white shadow-md z-10 flex items-center justify-center`}
      >
        <Circle className={`h-3 w-3 ${style.textColor} fill-current`} />
      </div>
    )
  }

  const getRouteColor = (routeColor?: string): string => {
    if (!routeColor || routeColor.trim() === "") {
      return "#0891b2" // デフォルトのプライマリカラー
    }

    // 6桁のHEXカラーコードの場合は#を追加
    if (/^[0-9A-Fa-f]{6}$/.test(routeColor)) {
      return `#${routeColor}`
    }

    // 既に#が付いている場合はそのまま使用
    if (routeColor.startsWith("#")) {
      return routeColor
    }

    return "#0891b2" // 無効な形式の場合はデフォルト
  }

  const getRouteColorStyle = (routeColor?: string) => {
    const color = getRouteColor(routeColor)
    return {
      backgroundColor: `${color}40`, // 25%の透明度
      borderColor: color,
    }
  }

  const getVerticalLineColor = (segments: TransitSegment[], segmentIndex: number) => {
    const currentSegment = segments[segmentIndex]
    if (isWalkingSegment(currentSegment)) {
      // 徒歩区間の場合は前後の電車区間の色を確認
      const prevTrainSegment = segments
        .slice(0, segmentIndex)
        .reverse()
        .find((s) => !isWalkingSegment(s))
      const nextTrainSegment = segments.slice(segmentIndex + 1).find((s) => !isWalkingSegment(s))
      return getRouteColor(prevTrainSegment?.route.route_color || nextTrainSegment?.route.route_color)
    }
    return getRouteColor(currentSegment.route.route_color)
  }

  const getSegmentInfo = (segment: TransitSegment) => {
    if (isWalkingSegment(segment)) {
      return null
    }

    // 駅数は実際に停車する駅で数える（通過駅は除外）。途中停車駅＋降車駅。
    // stop_sequence の差だと急行などの通過駅まで数えてしまい「○駅」が過大になる。
    const stationCount = getIntermediateStops(segment).length + 1

    // 時刻から所要時間を計算
    const parseTime = (timeStr: string) => {
      const [hours, minutes] = timeStr.split(":").map(Number)
      return hours * 60 + minutes
    }

    const departureMinutes = parseTime(segment.departureTime)
    const arrivalMinutes = parseTime(segment.arrivalTime)
    const duration = arrivalMinutes - departureMinutes

    return {
      stationCount,
      duration: duration > 0 ? duration : 0,
    }
  }

  const hasExcludedTrips = () => {
    // 検索時にdelayManager.loadTripVisibilitySettings()で更新されたキャッシュを参照
    const visibilitySettings = getCachedTripVisibilitySettings()

    return route.segments.some((segment) => {
      if (segment.type === "walking") {
        return false
      }
      // 繰り返し展開の複製便は基本便の表示設定を参照
      return visibilitySettings[segment.trip.base_trip_id ?? segment.trip.trip_id] === false
    })
  }

  const isExcludedRoute = hasExcludedTrips()

  const getTripStatusTooltip = (tripId: string, tripShortName: string) => {
    tripId = gtfsParser.getBaseTripId(tripId) // 複製便は基本便の運行情報を参照
    const delayInfo = delayManager.getDelayInfoForTrip(tripId)
    const operationStatus = delayManager.getOperationStatusForTrip(tripId)

    if (delayInfo) {
      const statusMessage = delayManager.generateStatusMessage(delayInfo)
      const lastUpdated = new Date(delayInfo.lastUpdated).toLocaleString("ja-JP", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
      return `運用 ${tripShortName}: ${statusMessage}\n最終更新: ${lastUpdated}`
    }

    return `運用 ${tripShortName}: ${operationStatus?.statusMessage || "定刻運行中"}`
  }

  const getDelayStatusColor = (tripId: string) => {
    tripId = gtfsParser.getBaseTripId(tripId) // 複製便は基本便の運行情報を参照
    const delayInfo = delayManager.getDelayInfoForTrip(tripId)
    if (!delayInfo) return "#16a34a" // green-600 (定刻)

    // 早着は扱わない（定刻と同じ扱い）
    switch (delayInfo.status) {
      case "delayed":
        return "#dc2626" // red-600
      case "cancelled":
        return "#6b7280" // gray-500
      default:
        return "#16a34a" // green-600
    }
  }

  const getDelayStatusBadge = (tripId: string) => {
    tripId = gtfsParser.getBaseTripId(tripId) // 複製便は基本便の運行情報を参照
    const delayInfo = delayManager.getDelayInfoForTrip(tripId)
    if (!delayInfo || delayInfo.status === "on-time") return null

    switch (delayInfo.status) {
      case "delayed":
        return (
          <Badge variant="destructive" className="text-xs ml-2">
            遅れあり
          </Badge>
        )
      case "cancelled":
        return (
          <Badge variant="outline" className="text-xs ml-2 bg-gray-50 text-gray-700 border-gray-300">
            運休
          </Badge>
        )
      default:
        return null
    }
  }

  const getPlatformDisplay = (tripId: string, stopId: string, type: "arrival" | "departure") => {
    const stopTime = gtfsParser.getStopTimeForTripAndStop(tripId, stopId)
    if (!stopTime?.platform_code) return null

    const suffix = type === "arrival" ? "着" : "発"
    return `${stopTime.platform_code}番線${suffix}`
  }

  // 駅名と、その隣の「時刻表」リンク（画像のように駅名の隣に表示領域を設ける）
  const renderStationName = (stop: GTFSStop, className: string) => (
    <>
      <span className={className}>{stop.stop_name}</span>
      {onStationClick && (
        <button
          type="button"
          onClick={() => onStationClick(stop)}
          className="rounded border border-green-600 px-1.5 py-0.5 text-[10px] font-medium text-green-700 transition-colors hover:bg-green-50"
          title={`${stop.stop_name} の時刻表を見る`}
        >
          時刻表
        </button>
      )}
    </>
  )

  return (
    <TooltipProvider>
      <Card
        className={`hover:shadow-md transition-shadow ${isExcludedRoute ? "border-orange-300 bg-orange-50/30" : ""}`}
      >
        <CardHeader className="space-y-0 px-3 py-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="rounded bg-green-700 px-2 py-0.5 text-xs font-bold text-white">ルート{index + 1}</span>
              {badges.map((b) => {
                const meta = {
                  fast: { label: "早", title: "最も早く到着", cls: "bg-red-500" },
                  easy: { label: "楽", title: "乗り換えが最少", cls: "bg-blue-500" },
                  short: { label: "短", title: "所要時間が最短", cls: "bg-emerald-600" },
                }[b]
                return (
                  <span
                    key={b}
                    title={meta.title}
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white ${meta.cls}`}
                  >
                    {meta.label}
                  </span>
                )
              })}
              <span className="font-semibold text-base">{formatTime(route.departureTime)}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-semibold text-base">{formatTime(route.arrivalTime)}</span>
              {route.transfers === 0 ? (
                <Badge variant="secondary" className="bg-green-100 text-green-800 text-[10px] px-1.5 py-0">
                  乗換なし
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  乗換 {route.transfers}回
                </Badge>
              )}
              {isExcludedRoute && (
                <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 text-[10px] px-1.5 py-0">
                  運休含む
                </Badge>
              )}
              {route.walkingDistance > 0 && (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 text-[10px] px-1.5 py-0">
                  徒歩 {formatDistance(route.walkingDistance)}
                </Badge>
              )}
            </div>
            <div className="flex items-baseline gap-1 whitespace-nowrap">
              <span className="text-xs text-muted-foreground">所要</span>
              <span className="font-semibold">{formatDuration(route.totalDuration)}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="relative">
            {route.segments.map((segment, segmentIndex) => {
              const isFirstSegment = segmentIndex === 0
              const isLastSegment = segmentIndex === route.segments.length - 1
              const nextSegment = !isLastSegment ? route.segments[segmentIndex + 1] : null

              return (
                <div key={segmentIndex} className="relative">
                  {/* 各セグメントの縦線 */}
                  <div
                    className="absolute w-1 z-0 rounded-full"
                    style={{
                      backgroundColor: isWalkingSegment(segment) ? "#9ca3af" : getRouteColor(segment.route.route_color),
                      left: "calc(1.5rem - 2px)", // アイコンの中央
                      top: isFirstSegment ? "1.5rem" : "0", // 最初のセグメントは駅アイコンから開始
                      height: isLastSegment
                        ? route.segments.length === 1
                          ? "calc(100% - 3rem)"
                          : "calc(100% - 1.5rem)"
                        : "100%", // 単一セグメントの場合は短く、複数セグメントの場合は通常通り
                      backgroundImage: isWalkingSegment(segment)
                        ? "repeating-linear-gradient(0deg, transparent, transparent 4px, rgba(255,255,255,0.8) 4px, rgba(255,255,255,0.8) 8px)"
                        : undefined,
                      zIndex: 0,
                    }}
                  />

                  {isFirstSegment && (
                    <div className="flex items-start space-x-3 py-1">
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 flex items-center space-x-3 w-full relative z-10">
                        <div className="flex flex-col items-center relative z-30 ml-[3px]">
                          <StationIcon type="departure" />
                        </div>
                        <div className="flex-1 flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm font-medium text-blue-600 whitespace-nowrap">
                            {formatTime(segment.departureTime)} 発
                          </span>
                          {renderStationName(segment.fromStop, "text-base font-semibold text-blue-900")}
                          {!isWalkingSegment(segment) &&
                            segment.route.route_type !== 3 &&
                            (() => {
                              const platform = getPlatformDisplay(
                                segment.trip.trip_id,
                                segment.fromStop.stop_id,
                                "departure",
                              )
                              return platform ? (
                                <span className="text-[10px] text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded border">
                                  {platform}
                                </span>
                              ) : null
                            })()}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="relative py-1.5">
                    <div className="ml-16">
                      {isWalkingSegment(segment) ? (
                        (() => {
                          // 徒歩後、次の乗物に乗るまでの待ち時間も明示する（徒歩N分 ＋ 待ちM分）
                          const wait =
                            nextSegment && !isWalkingSegment(nextSegment)
                              ? calculateWaitTime(segment.arrivalTime, nextSegment.departureTime)
                              : 0
                          return (
                            <div className="flex items-center space-x-2 text-sm bg-gray-50 rounded-lg p-3 border border-gray-200">
                              <svg className="h-4 w-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M16 17l-4 4-4-4m4-12v16"
                                />
                                <circle cx="12" cy="6" r="2" />
                              </svg>
                              <span className="font-medium text-gray-600">徒歩</span>
                              <span className="text-muted-foreground">{formatDuration(segment.duration)}</span>
                              {wait > 0 && (
                                <span className="text-muted-foreground">＋ 待ち {wait}分</span>
                              )}
                            </div>
                          )
                        })()
                      ) : (
                        (() => {
                          const transportInfo = getTransportIcon(segment.route.route_type)
                          const IconComponent = transportInfo.icon
                          const segmentColorStyle = getRouteColorStyle(segment.route.route_color)
                          // 車両は運用（trip_short_name）単位で割り当て（キャッシュから同期取得）
                          const assignedVehicle = vehicleManager.getCachedVehicleForOperation(
                            segment.trip.trip_short_name,
                          )

                          return (
                            <div
                              className="flex items-center space-x-2 text-sm border px-3 py-1.5"
                              style={{
                                backgroundColor: segmentColorStyle.backgroundColor,
                                borderColor: segmentColorStyle.borderColor,
                              }}
                            >
                              <IconComponent
                                className="h-4 w-4"
                                style={{ color: getRouteColor(segment.route.route_color) }}
                              />
                              <span className="font-medium" style={{ color: getRouteColor(segment.route.route_color) }}>
                                {segment.route.route_short_name || segment.route.route_long_name}
                              </span>
                              {segment.trip.trip_short_name && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openRequestDialog({
                                          tripShortName: segment.trip.trip_short_name!,
                                          routeName: segment.route.route_short_name || segment.route.route_long_name,
                                          headsign: segment.trip.trip_headsign,
                                        })
                                      }
                                      className="text-xs font-mono text-white px-1.5 py-0.5 rounded border cursor-pointer hover:opacity-80 transition-opacity"
                                      style={{ backgroundColor: getDelayStatusColor(segment.trip.trip_id) }}
                                    >
                                      {segment.trip.trip_short_name}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-xs">
                                    <p className="text-sm whitespace-pre-line">
                                      {getTripStatusTooltip(segment.trip.trip_id, segment.trip.trip_short_name)}
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">タップでリクエストを送信</p>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              {segment.trip.trip_short_name && getDelayStatusBadge(segment.trip.trip_id)}
                              {segment.trip.trip_short_name &&
                                segment.route.route_type !== 3 &&
                                runningOps.has(segment.trip.trip_short_name) && (
                                <Link
                                  href={`/live?focus=${encodeURIComponent(segment.trip.trip_short_name)}`}
                                  className="inline-flex items-center gap-1 rounded border border-emerald-500 bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                                  title="この運用の現在の走行位置を見る"
                                >
                                  <Navigation className="h-3 w-3" />
                                  走行位置
                                </Link>
                              )}
                              {segment.trip.trip_headsign && (
                                <span className="text-muted-foreground">({segment.trip.trip_headsign})</span>
                              )}
                              {assignedVehicle && (
                                <div className="flex items-center gap-1 ml-2 bg-white/70 px-2 py-1 rounded border">
                                  <div className="flex items-center">
                                    {assignedVehicle.iconUrl ? (
                                      <>
                                        <img
                                          src={assignedVehicle.iconUrl || "/placeholder.svg"}
                                          alt={assignedVehicle.name}
                                          className="h-4 w-4 object-contain rounded"
                                          onError={(e) => {
                                            const target = e.target as HTMLImageElement
                                            target.style.display = "none"
                                            const fallback = target.nextElementSibling as HTMLElement
                                            if (fallback) fallback.classList.remove("hidden")
                                          }}
                                        />
                                        <span className="hidden">
                                          {(() => {
                                            const lowerType = (assignedVehicle.type || "").toLowerCase()
                                            if (lowerType.includes("バス")) return <Bus className="h-3 w-3" />
                                            if (lowerType.includes("電車") || lowerType.includes("特急"))
                                              return <Train className="h-3 w-3" />
                                            return <Car className="h-3 w-3" />
                                          })()}
                                        </span>
                                      </>
                                    ) : (
                                      (() => {
                                        const lowerType = (assignedVehicle.type || "").toLowerCase()
                                        if (lowerType.includes("バス")) return <Bus className="h-3 w-3" />
                                        if (lowerType.includes("電車") || lowerType.includes("特急"))
                                          return <Train className="h-3 w-3" />
                                        return <Car className="h-3 w-3" />
                                      })()
                                    )}
                                  </div>
                                  <span className="text-xs text-muted-foreground font-medium">
                                    {assignedVehicle.name}
                                  </span>
                                </div>
                              )}
                            </div>
                          )
                        })()
                      )}
                    </div>

                    {/* 「N駅N分」を線の上の○マーカーとして表示（クリックで展開） */}
                    {!isWalkingSegment(segment) &&
                      (() => {
                        const segmentInfo = getSegmentInfo(segment)
                        if (!segmentInfo || segmentInfo.stationCount <= 0) return null
                        const color = getRouteColor(segment.route.route_color)
                        return (
                          <button
                            type="button"
                            onClick={() => toggleSegment(segmentIndex)}
                            className="absolute left-6 top-1/2 z-20 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-2 bg-white leading-none shadow-sm transition-transform hover:scale-105"
                            style={{ borderColor: color, color }}
                          >
                            <span className="text-[11px] font-bold">{segmentInfo.stationCount}駅</span>
                            <span className="text-[9px]">{formatDuration(segmentInfo.duration)}</span>
                          </button>
                        )
                      })()}
                  </div>

                  {/* 途中停車駅（展開時）：太い縦線の上に小さな○を重ねて表示 */}
                  {!isWalkingSegment(segment) &&
                    expandedSegments.has(segmentIndex) &&
                    (() => {
                      const intermediateStops = getIntermediateStops(segment)
                      const color = getRouteColor(segment.route.route_color)
                      if (intermediateStops.length === 0) {
                        return <p className="ml-16 pb-2 text-xs text-muted-foreground">途中に停車駅はありません</p>
                      }
                      return (
                        <div className="space-y-1 pb-1">
                          {intermediateStops.map((stop, i) => (
                            <div key={i} className="relative flex items-center">
                              <span
                                className="absolute left-6 top-1/2 z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white"
                                style={{ borderColor: color }}
                              />
                              <span className="ml-16 w-12 tabular-nums text-xs text-muted-foreground">{stop.time}</span>
                              <span className="text-sm text-foreground">{stop.name}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })()}

                  <div className="flex items-start space-x-3 py-1">
                    <div
                      className={`border rounded-lg p-2 flex items-center space-x-3 w-full relative z-10 ${
                        isLastSegment ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-200"
                      }`}
                    >
                      <div className="flex flex-col items-center relative z-30">
                        <StationIcon type={isLastSegment ? "arrival" : "transfer"} />
                      </div>
                      <div className="flex-1">
                        {!isLastSegment ? (
                          <div>
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="text-sm font-medium text-blue-600 whitespace-nowrap">
                                {formatTime(segment.arrivalTime)} 着
                              </span>
                              {nextSegment && !isWalkingSegment(nextSegment) && (
                                <span className="text-sm font-medium text-green-700 whitespace-nowrap">
                                  {formatTime(nextSegment.departureTime)} 発
                                </span>
                              )}
                              {renderStationName(segment.toStop, "text-base font-semibold text-blue-900")}
                              {!isWalkingSegment(segment) &&
                                segment.route.route_type !== 3 &&
                                (() => {
                                  const arrivalPlatform = getPlatformDisplay(
                                    segment.trip.trip_id,
                                    segment.toStop.stop_id,
                                    "arrival",
                                  )
                                  const departurePlatform =
                                    nextSegment && !isWalkingSegment(nextSegment) && nextSegment.route.route_type !== 3
                                      ? getPlatformDisplay(
                                          nextSegment.trip.trip_id,
                                          nextSegment.fromStop.stop_id,
                                          "departure",
                                        )
                                      : null

                                  return (
                                    <div className="flex items-center space-x-1">
                                      {arrivalPlatform && (
                                        <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded border">
                                          {arrivalPlatform}
                                        </span>
                                      )}
                                      {departurePlatform && (
                                        <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded border">
                                          {departurePlatform}
                                        </span>
                                      )}
                                    </div>
                                  )
                                })()}
                              {!isWalkingSegment(segment) && !isWalkingSegment(route.segments[segmentIndex + 1]) && (
                                <span className="ml-auto flex items-center gap-1 whitespace-nowrap text-sm text-orange-700">
                                  <Clock className="h-3 w-3" />
                                  乗換
                                  {calculateWaitTime(segment.arrivalTime, route.segments[segmentIndex + 1].departureTime)}分
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="text-sm font-medium text-red-600 whitespace-nowrap">
                                {formatTime(segment.arrivalTime)} 着
                              </span>
                              {renderStationName(segment.toStop, "text-base font-semibold text-red-900")}
                              {!isWalkingSegment(segment) &&
                                segment.route.route_type !== 3 &&
                                (() => {
                                  const platform = getPlatformDisplay(
                                    segment.trip.trip_id,
                                    segment.toStop.stop_id,
                                    "arrival",
                                  )
                                  return platform ? (
                                    <span className="text-xs text-red-600 bg-red-100 px-2 py-1 rounded border">
                                      {platform}
                                    </span>
                                  ) : null
                                })()}
                            </div>
                          </div>
                        )}

                        {(() => {
                          const dropOffInfo = checkDropOffRestriction(segment)
                          return (
                            <>
                              {dropOffInfo.hasDropOffRestriction && !isLastSegment && (
                                <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded-md">
                                  <div className="flex items-center space-x-2">
                                    <AlertCircle className="h-4 w-4 text-yellow-600" />
                                    <p className="text-xs text-yellow-800 font-medium">
                                      ⚠️ この駅では通常降車できません
                                    </p>
                                  </div>
                                  <p className="text-xs text-yellow-700 mt-1">
                                    乗り換えには特別な手続きが必要な場合があります
                                  </p>
                                </div>
                              )}

                              {dropOffInfo.needsReservation && (
                                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-md">
                                  <div className="flex items-center space-x-2">
                                    <AlertCircle className="h-4 w-4 text-blue-600" />
                                    <p className="text-xs text-blue-800 font-medium">📞 事前予約が必要です</p>
                                  </div>
                                </div>
                              )}

                              {dropOffInfo.needsDriverContact && (
                                <div className="mt-2 p-2 bg-purple-50 border border-purple-200 rounded-md">
                                  <div className="flex items-center space-x-2">
                                    <AlertCircle className="h-4 w-4 text-purple-600" />
                                    <p className="text-xs text-purple-800 font-medium">🚌 運転手にお声がけください</p>
                                  </div>
                                </div>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* 運用リクエスト送信ダイアログ */}
      <Dialog open={requestTrip !== null} onOpenChange={(open) => !open && setRequestTrip(null)}>
        <DialogContent className="sm:max-w-md">
          {requestState === "done" ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  リクエストを送信しました
                </DialogTitle>
                <DialogDescription>
                  運用 {requestTrip?.tripShortName} のリクエストを管理者に送信しました。ご協力ありがとうございます。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => setRequestTrip(null)}>閉じる</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>運用 {requestTrip?.tripShortName} のリクエスト</DialogTitle>
                <DialogDescription>
                  この運用に関するリクエストを管理者に送信します
                  {requestTrip?.routeName ? `（${requestTrip.routeName}` : ""}
                  {requestTrip?.headsign ? `${requestTrip?.routeName ? " " : "（"}${requestTrip.headsign}` : ""}
                  {requestTrip?.routeName || requestTrip?.headsign ? "）" : ""}。
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Textarea
                  value={requestMessage}
                  onChange={(e) => setRequestMessage(e.target.value)}
                  placeholder="ひとこと（任意）例: この運用を増発してほしい / 車両を知りたい など"
                  maxLength={200}
                  rows={3}
                />
                {requestState === "error" && <p className="text-sm text-destructive">{requestError}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRequestTrip(null)} disabled={requestState === "sending"}>
                  キャンセル
                </Button>
                <Button onClick={submitRequest} disabled={requestState === "sending"}>
                  {requestState === "sending" ? (
                    <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-1 h-4 w-4" />
                  )}
                  送信
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}
