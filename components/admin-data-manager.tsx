"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Database,
  Trash2,
  Download,
  MapPin,
  Route,
  Clock,
  Users,
  Plus,
  AlertTriangle,
  CheckCircle,
  Search,
  Settings,
  Car,
  Footprints,
  History,
  Inbox,
} from "lucide-react"
import { GTFSStorage, type GTFSDataset } from "@/lib/gtfs-storage"
import { gtfsParser } from "@/lib/gtfs-parser"
import { GTFSFileUploader } from "@/components/gtfs-file-uploader"
import { TripManager } from "@/components/trip-manager"
import { VehicleManager } from "@/components/vehicle-manager"
import { RouteSettingsManager } from "@/components/route-settings-manager"
import { SearchHistoryViewer } from "@/components/search-history-viewer"
import { OperationRequestViewer } from "@/components/operation-request-viewer"
import { StationCoordinateManager } from "@/components/station-coordinate-manager"

interface AdminDataManagerProps {
  onDataLoaded: () => void
}

// 管理画面のセクション。タブで切り替える（従来の全画面置換＋戻るボタン方式を廃止）。
type AdminSection = "datasets" | "trips" | "vehicles" | "routes" | "coords" | "requests" | "history"

const ADMIN_TABS: { key: AdminSection; label: string; icon: typeof Database; needsData?: boolean }[] = [
  { key: "datasets", label: "データ管理", icon: Database },
  { key: "trips", label: "運用管理", icon: Settings, needsData: true },
  { key: "vehicles", label: "車両管理", icon: Car, needsData: true },
  { key: "routes", label: "経路・徒歩設定", icon: Footprints, needsData: true },
  { key: "coords", label: "駅座標", icon: MapPin, needsData: true },
  { key: "requests", label: "運用リクエスト", icon: Inbox },
  { key: "history", label: "検索履歴", icon: History },
]

export function AdminDataManager({ onDataLoaded }: AdminDataManagerProps) {
  const [datasets, setDatasets] = useState<GTFSDataset[]>([])
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null)
  const [section, setSection] = useState<AdminSection>("datasets")
  const [showUploader, setShowUploader] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    loadDatasets()
  }, [])

  const loadDatasets = async () => {
    try {
      const allDatasets = await GTFSStorage.getAllDatasets()
      const activeDataset = await GTFSStorage.getActiveDataset()

      setDatasets(allDatasets)
      setActiveDatasetId(activeDataset?.id || null)
    } catch (error) {
      console.error("[v0] データセットの読み込みに失敗:", error)
    }
  }

  const handleSwitchDataset = async (datasetId: string) => {
    setIsLoading(true)
    try {
      await GTFSStorage.setActiveDataset(datasetId)

      gtfsParser.clearData()

      const newParser = new (gtfsParser.constructor as any)()
      Object.setPrototypeOf(gtfsParser, newParser)

      setActiveDatasetId(datasetId)
      onDataLoaded()

      console.log("[v0] データセットを切り替えました:", datasetId)
    } catch (error) {
      console.error("[v0] データセットの切り替えに失敗:", error)
      alert("データセットの切り替えに失敗しました。")
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteDataset = async (datasetId: string) => {
    const dataset = datasets.find((d) => d.id === datasetId)
    if (!dataset) return

    const confirmed = confirm(`データセット「${dataset.name}」を削除しますか？\nこの操作は取り消せません。`)
    if (!confirmed) return

    try {
      await GTFSStorage.deleteDataset(datasetId)
      await loadDatasets()

      if (datasetId === activeDatasetId) {
        gtfsParser.clearData()
        setActiveDatasetId(null)
      }

      console.log("[v0] データセットを削除しました:", dataset.name)
    } catch (error) {
      console.error("[v0] データセットの削除に失敗:", error)
      alert("データセットの削除に失敗しました。")
    }
  }

  const handleNewUpload = () => {
    setShowUploader(true)
  }

  const handleUploadComplete = async () => {
    setShowUploader(false)
    await loadDatasets()
    onDataLoaded()
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
    return `${Math.round(bytes / 1024 / 1024)}MB`
  }

  const getDatasetStats = (dataset: GTFSDataset) => {
    return {
      stops: dataset.stops.length,
      routes: dataset.routes.length,
      trips: dataset.trips.length,
      stopTimes: dataset.stopTimes.length,
    }
  }

  const storageInfo = { used: 0, total: 0, percentage: 0 }

  if (showUploader) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">新しいGTFSデータセットをアップロード</h2>
          <Button variant="outline" onClick={() => setShowUploader(false)}>
            データ管理に戻る
          </Button>
        </div>
        <GTFSFileUploader onDataLoaded={handleUploadComplete} />
      </div>
    )
  }

  const backToDatasets = () => setSection("datasets")

  // タブバー（常時表示）。データセット未選択時は運用管理などデータ依存タブを隠す。
  const tabBar = (
    <div className="flex flex-wrap gap-1 border-b border-border">
      {ADMIN_TABS.filter((t) => !t.needsData || activeDatasetId).map((t) => {
        const active = section === t.key
        const Icon = t.icon
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => setSection(t.key)}
            aria-current={active ? "page" : undefined}
            className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
              active
                ? "border-primary font-semibold text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </button>
        )
      })}
    </div>
  )

  if (section !== "datasets") {
    return (
      <div className="space-y-6">
        {tabBar}
        {section === "trips" && (
          <TripManager
            onVisibilityChange={onDataLoaded}
            onBack={backToDatasets}
            onShowVehicleManager={() => setSection("vehicles")}
          />
        )}
        {section === "vehicles" && <VehicleManager onBack={backToDatasets} />}
        {section === "routes" && <RouteSettingsManager onBack={backToDatasets} />}
        {section === "coords" && <StationCoordinateManager onBack={backToDatasets} />}
        {section === "requests" && <OperationRequestViewer onBack={backToDatasets} />}
        {section === "history" && <SearchHistoryViewer onBack={backToDatasets} />}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {tabBar}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">GTFSデータ管理</h2>
          <p className="text-muted-foreground">保存されたデータセットの管理と切り替え</p>
        </div>
        <Button onClick={handleNewUpload}>
          <Plus className="h-4 w-4 mr-2" />
          新しいデータセットをアップロード
        </Button>
      </div>

      <Alert>
        <Database className="h-4 w-4" />
        <AlertDescription>データはサーバーに保存され、すべてのユーザーが共有できます。</AlertDescription>
      </Alert>

      {datasets.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">データセットがありません</h3>
            <p className="text-muted-foreground mb-4">最初のGTFSデータセットをアップロードしてください。</p>
            <Button onClick={handleNewUpload}>
              <Plus className="h-4 w-4 mr-2" />
              データセットをアップロード
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {datasets.map((dataset) => {
            const stats = getDatasetStats(dataset)
            const isActive = dataset.id === activeDatasetId

            return (
              <Card key={dataset.id} className={isActive ? "border-primary bg-primary/5" : ""}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-lg">{dataset.name}</CardTitle>
                        {isActive && (
                          <Badge variant="default" className="text-xs">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            使用中
                          </Badge>
                        )}
                      </div>
                      <CardDescription>アップロード日時: {formatDate(dataset.uploadDate)}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {!isActive && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSwitchDataset(dataset.id)}
                          disabled={isLoading}
                        >
                          <Download className="h-4 w-4 mr-1" />
                          使用する
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteDataset(dataset.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>{stats.stops.toLocaleString()}駅</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Route className="h-4 w-4 text-muted-foreground" />
                      <span>{stats.routes.toLocaleString()}路線</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span>{stats.trips.toLocaleString()}運行</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>{stats.stopTimes.toLocaleString()}時刻</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {datasets.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>すべてのデータセットを削除する場合は、右のボタンをクリックしてください。</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                const confirmed = confirm("すべてのGTFSデータセットを削除しますか？\nこの操作は取り消せません。")
                if (confirmed) {
                  try {
                    await GTFSStorage.clearAllData()
                    gtfsParser.clearData()
                    setDatasets([])
                    setActiveDatasetId(null)
                  } catch (error) {
                    console.error("[v0] 全データ削除に失敗:", error)
                    alert("データの削除に失敗しました。")
                  }
                }
              }}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              すべて削除
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="pt-6 border-t border-border">
        <div className="text-center space-y-3">
          <p className="text-sm text-muted-foreground">経路検索を開始しますか？</p>
          <Button
            onClick={() => {
              window.location.href = "/"
            }}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            size="lg"
          >
            <Search className="h-4 w-4 mr-2" />
            新しい検索
          </Button>
        </div>
      </div>
    </div>
  )
}
