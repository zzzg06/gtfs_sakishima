"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Upload, FileText, CheckCircle, AlertCircle, XCircle, Save, HardDrive } from "lucide-react"
import { gtfsParser } from "@/lib/gtfs-parser"
import {
  readFileWithEncoding,
  validateCSVFormat,
  GTFS_REQUIRED_COLUMNS,
  type CSVValidationResult,
} from "@/lib/encoding-detector"

interface FileUploadStatus {
  stops: boolean
  routes: boolean
  trips: boolean
  stopTimes: boolean
  calendar: boolean
}

interface FileStatus {
  uploaded: boolean
  error?: string
  validation?: CSVValidationResult
}

interface GTFSFileUploaderProps {
  onDataLoaded: () => void
}

export function GTFSFileUploader({ onDataLoaded }: GTFSFileUploaderProps) {
  const [fileStatus, setFileStatus] = useState<Record<keyof FileUploadStatus, FileStatus>>({
    stops: { uploaded: false },
    routes: { uploaded: false },
    trips: { uploaded: false },
    stopTimes: { uploaded: false },
    calendar: { uploaded: false },
  })
  const [isLoading, setIsLoading] = useState(false)
  const [datasetName, setDatasetName] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const handleFileUpload = async (file: File, type: keyof FileUploadStatus) => {
    setIsLoading(true)

    setFileStatus((prev) => ({
      ...prev,
      [type]: { uploaded: false, error: undefined },
    }))

    try {
      console.log(`[v0] Starting upload for ${type}: ${file.name}`)

      const content = await readFileWithEncoding(file)
      console.log(`[v0] File content length: ${content.length}`)

      const requiredColumns = GTFS_REQUIRED_COLUMNS[type]
      const validation = validateCSVFormat(content, requiredColumns)

      if (!validation.isValid) {
        throw new Error(`CSVファイルの形式が正しくありません:\n${validation.errors.join("\n")}`)
      }

      console.log(`[v0] CSV validation passed for ${type}. Rows: ${validation.rowCount}`)

      switch (type) {
        case "stops":
          await gtfsParser.loadStops(content)
          break
        case "routes":
          await gtfsParser.loadRoutes(content)
          break
        case "trips":
          await gtfsParser.loadTrips(content)
          break
        case "stopTimes":
          await gtfsParser.loadStopTimes(content)
          break
        case "calendar":
          await gtfsParser.loadCalendar(content)
          break
      }

      setFileStatus((prev) => ({
        ...prev,
        [type]: { uploaded: true, validation },
      }))

      console.log(`[v0] Successfully loaded ${type}`)

      if (!datasetName) {
        const now = new Date()
        const dateStr = now
          .toLocaleDateString("ja-JP", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })
          .replace(/\//g, "-")
        const timeStr = now
          .toLocaleTimeString("ja-JP", {
            hour: "2-digit",
            minute: "2-digit",
          })
          .replace(/:/g, "")
        setDatasetName(`GTFSデータ_${dateStr}_${timeStr}`)
      }
    } catch (error) {
      console.error(`[v0] Error loading ${type}:`, error)
      setFileStatus((prev) => ({
        ...prev,
        [type]: {
          uploaded: false,
          error: error instanceof Error ? error.message : "不明なエラーが発生しました",
        },
      }))
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveAndComplete = async () => {
    if (!allFilesLoaded || !datasetName.trim()) return

    setIsSaving(true)
    try {
      // Save to server storage
      await gtfsParser.saveToStorage(datasetName.trim())

      // Complete the upload process
      onDataLoaded()

      console.log(`[v0] GTFSデータセット "${datasetName}" をサーバーに保存し、アップロードを完了しました`)
    } catch (error) {
      console.error("[v0] データの保存に失敗:", error)
      // Show error but don't prevent completion
      alert("データの保存に失敗しましたが、一時的にデータは利用可能です。")
      onDataLoaded()
    } finally {
      setIsSaving(false)
    }
  }

  const FileUploadButton = ({
    type,
    label,
    description,
  }: {
    type: keyof FileUploadStatus
    label: string
    description: string
  }) => {
    const status = fileStatus[type]

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">{label}</p>
              <p className="text-sm text-muted-foreground">{description}</p>
              {status.validation && (
                <p className="text-xs text-green-600">{status.validation.rowCount}行のデータを検出</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status.uploaded ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : status.error ? (
              <XCircle className="h-5 w-5 text-red-500" />
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={isLoading}
                onClick={() => {
                  const input = document.createElement("input")
                  input.type = "file"
                  input.accept = ".csv,.txt"
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0]
                    if (file) {
                      handleFileUpload(file, type)
                    }
                  }
                  input.click()
                }}
              >
                <Upload className="h-4 w-4 mr-2" />
                アップロード
              </Button>
            )}
          </div>
        </div>
        {status.error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-2">
              <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-700">
                <p className="font-medium">アップロードエラー</p>
                <pre className="mt-1 whitespace-pre-wrap text-xs">{status.error}</pre>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  const allFilesLoaded = Object.values(fileStatus).every((status) => status.uploaded)
  const storageInfo = { used: 0, total: 0, percentage: 0 }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-6 w-6" />
          GTFSファイルアップロード
        </CardTitle>
        <CardDescription>
          乗換案内を利用するために、以下のGTFS CSVファイルをアップロードしてください。
          <br />
          <span className="text-xs text-muted-foreground">※ UTF-8またはShift_JIS形式のCSVファイルに対応しています</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FileUploadButton type="stops" label="stops.csv" description="駅・停留所の情報" />
        <FileUploadButton type="routes" label="routes.csv" description="路線の情報" />
        <FileUploadButton type="trips" label="trips.csv" description="運行の情報" />
        <FileUploadButton type="stopTimes" label="stop_times.csv" description="時刻表の情報" />
        <FileUploadButton type="calendar" label="calendar.csv" description="運行日の情報" />

        {allFilesLoaded && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <p className="text-green-700 font-medium">すべてのファイルが正常にアップロードされました！</p>
            </div>

            <div className="space-y-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-2">
                <Save className="h-4 w-4 text-blue-600" />
                <Label htmlFor="dataset-name" className="text-sm font-medium text-blue-900">
                  データセット名
                </Label>
              </div>
              <Input
                id="dataset-name"
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                placeholder="例: 関南電鉄_2024年春ダイヤ"
                className="bg-white"
              />
              <Button onClick={handleSaveAndComplete} disabled={!datasetName.trim() || isSaving} className="w-full">
                {isSaving ? (
                  <>
                    <HardDrive className="h-4 w-4 mr-2 animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    データを保存して完了
                  </>
                )}
              </Button>
              <p className="text-xs text-blue-700">
                データはサーバーに保存され、すべてのユーザーが利用できるようになります。
              </p>
            </div>
          </div>
        )}

        {!allFilesLoaded && (
          <div className="flex items-center gap-2 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <AlertCircle className="h-5 w-5 text-blue-500" />
            <p className="text-blue-700 text-sm">
              乗換案内を利用するには、すべてのCSVファイルをアップロードする必要があります。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
