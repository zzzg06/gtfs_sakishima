"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ArrowLeft, Save, MapPin, RefreshCw } from "lucide-react"
import { gtfsParser } from "@/lib/gtfs-parser"
import { stationCoordinateManager, type StationCoordinates } from "@/lib/station-coordinates"

interface StationCoordinateManagerProps {
  onBack: () => void
}

export function StationCoordinateManager({ onBack }: StationCoordinateManagerProps) {
  const [coords, setCoords] = useState<StationCoordinates>({})
  const [stationNames, setStationNames] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState(false)
  const [filter, setFilter] = useState("")

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      try {
        if (!gtfsParser.hasData()) await gtfsParser.loadFromStorageAsync()
        const names = Array.from(new Set(gtfsParser.getStops().map((s) => s.stop_name))).sort((a, b) =>
          a.localeCompare(b, "ja"),
        )
        setStationNames(names)
        setCoords(await stationCoordinateManager.load())
      } catch (err) {
        setError(err instanceof Error ? err.message : "読み込みに失敗しました")
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  const setAxis = (name: string, axis: "x" | "z", value: string) => {
    setSavedMsg(false)
    setCoords((prev) => {
      const next = { ...prev }
      if (value.trim() === "") {
        // 両方空なら削除
        const other = axis === "x" ? next[name]?.z : next[name]?.x
        if (other == null) {
          delete next[name]
          return next
        }
      }
      const cur = next[name] || { x: 0, z: 0 }
      next[name] = { ...cur, [axis]: Number(value) || 0 }
      return next
    })
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)
    try {
      await stationCoordinateManager.save(coords)
      setSavedMsg(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました")
    } finally {
      setIsSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const q = filter.trim()
    return q ? stationNames.filter((n) => n.includes(q)) : stationNames
  }, [stationNames, filter])

  const registeredCount = Object.keys(coords).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            戻る
          </Button>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            駅座標（Minecraft X/Z）
          </h2>
        </div>
        <Button onClick={handleSave} disabled={isSaving || isLoading}>
          {isSaving ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          保存
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        各駅・停留所のMinecraftワールド座標を登録します。列車現在位置API（/api/train-positions）やDynmap連携の位置計算に使われます。
        登録済み {registeredCount} / {stationNames.length} 駅。
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {savedMsg && (
        <Alert>
          <AlertDescription>保存しました。</AlertDescription>
        </Alert>
      )}

      <Input placeholder="駅名で絞り込み" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">読み込み中...</p>
      ) : (
        <div className="max-h-[32rem] overflow-y-auto rounded border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">駅・停留所</th>
                <th className="px-3 py-2 font-medium w-28">X</th>
                <th className="px-3 py-2 font-medium w-28">Z</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((name) => {
                const c = coords[name]
                const isBus = name.startsWith("(バス)")
                return (
                  <tr key={name} className="border-t border-border">
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-1.5">
                        {isBus && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            バス
                          </Badge>
                        )}
                        {name}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        value={c?.x ?? ""}
                        onChange={(e) => setAxis(name, "x", e.target.value)}
                        className="h-8"
                        placeholder="X"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        value={c?.z ?? ""}
                        onChange={(e) => setAxis(name, "z", e.target.value)}
                        className="h-8"
                        placeholder="Z"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
