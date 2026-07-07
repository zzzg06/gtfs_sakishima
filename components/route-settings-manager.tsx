"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Footprints, Save, Clock } from "lucide-react"
import { routeSettingsManager, DEFAULT_ROUTE_SETTINGS, type RouteSettings } from "@/lib/route-settings"
import { getWalkSegments } from "@/lib/walk-list"

interface RouteSettingsManagerProps {
  onBack: () => void
}

export function RouteSettingsManager({ onBack }: RouteSettingsManagerProps) {
  const [settings, setSettings] = useState<RouteSettings>({ ...DEFAULT_ROUTE_SETTINGS })
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const walkSegments = getWalkSegments()

  useEffect(() => {
    routeSettingsManager.loadSettings().then(setSettings)
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    setMessage(null)
    try {
      await routeSettingsManager.saveSettings(settings)
      setMessage({ type: "success", text: "設定を保存しました" })
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "保存に失敗しました" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          戻る
        </Button>
        <h2 className="text-xl font-semibold">経路・徒歩設定</h2>
      </div>

      {message && (
        <Alert variant={message.type === "error" ? "destructive" : "default"}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            乗り換え設定
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs">
            <Label htmlFor="maxWait">乗り換え許容待ち時間（分）</Label>
            <Input
              id="maxWait"
              type="number"
              min={0}
              value={settings.maxTransferWaitMinutes}
              onChange={(e) =>
                setSettings({ ...settings, maxTransferWaitMinutes: Number.parseInt(e.target.value) || 0 })
              }
            />
            <p className="text-xs text-muted-foreground mt-1">
              乗り換え時にこの時間まで待つ経路を提案します（本数が少ない路線では長めが有効）
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={isSaving}>
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? "保存中..." : "保存"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Footprints className="h-5 w-5" />
            徒歩区間リスト（{walkSegments.length}件）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4">
            <AlertDescription className="text-sm">
              徒歩は座標方式を廃止し、このリストに記載された区間のみで考慮されます。
              <strong>Y</strong>＝連続して徒歩可、<strong>W</strong>＝単独でのみ徒歩可。
              <br />
              リストは <span className="font-mono text-xs">data/徒歩リスト.xlsx</span> を編集して{" "}
              <span className="font-mono text-xs">npm run convert:walk</span> で更新します。
            </AlertDescription>
          </Alert>
          <div className="max-h-[28rem] overflow-y-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium w-16">ID</th>
                  <th className="px-3 py-2 font-medium">区間</th>
                  <th className="px-3 py-2 font-medium w-16">時間</th>
                  <th className="px-3 py-2 font-medium w-16">連続</th>
                </tr>
              </thead>
              <tbody>
                {walkSegments.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-3 py-1.5 font-mono text-xs">{s.id}</td>
                    <td className="px-3 py-1.5">
                      {s.a} ⇔ {s.b}
                    </td>
                    <td className="px-3 py-1.5">{s.time}分</td>
                    <td className="px-3 py-1.5">
                      {s.consecutive ? (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          連続可
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          単独
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
