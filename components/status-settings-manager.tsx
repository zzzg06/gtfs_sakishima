"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ArrowLeft, Bus, Car, Info, Plus, Save, Train, Trash2 } from "lucide-react"
import {
  DEFAULT_STATUS_SETTINGS,
  statusSettingsManager,
  type StatusDisplayMode,
  type StatusNotice,
  type StatusSection,
  type StatusSettings,
} from "@/lib/status-settings"

// 運行情報ページ(/status)の掲載設定。列車・バスの掲載可否、デマンド運行の注意書き、自由記述を管理する。

const MODES: { value: StatusDisplayMode; label: string; hint: string }[] = [
  { value: "on", label: "掲載する", hint: "下の本文を常に掲載します" },
  { value: "off", label: "掲載しない", hint: "何も出しません（イベント開催時間外など）" },
  { value: "auto", label: "自動判定", hint: "遅れが出ているときだけ自動で掲載します" },
]

function SectionEditor({
  icon: Icon,
  title,
  value,
  onChange,
}: {
  icon: typeof Train
  title: string
  value: StatusSection
  onChange: (next: StatusSection) => void
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => onChange({ ...value, mode: m.value })}
              title={m.hint}
              className={`rounded border px-3 py-1.5 text-sm transition-colors ${
                value.mode === m.value
                  ? "border-primary bg-primary font-semibold text-primary-foreground"
                  : "border-border bg-background hover:bg-muted"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{MODES.find((m) => m.value === value.mode)?.hint}</p>
        <div className="space-y-1.5">
          <Label className="text-xs">
            本文{value.mode === "auto" ? "（遅延を検知したときに添える補足。空欄可）" : ""}
          </Label>
          <Textarea
            value={value.message}
            onChange={(e) => onChange({ ...value, message: e.target.value })}
            rows={3}
            placeholder={
              value.mode === "auto"
                ? "例）遅れの状況は実位置から自動判定しています。"
                : "例）強風の影響により、一部列車に遅れが出ています。"
            }
            disabled={value.mode === "off"}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export function StatusSettingsManager({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<StatusSettings>({ ...DEFAULT_STATUS_SETTINGS })
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    statusSettingsManager.load().then(setSettings)
  }, [])

  const save = async () => {
    setIsSaving(true)
    setMessage(null)
    try {
      await statusSettingsManager.save(settings)
      setMessage({ type: "success", text: "運行情報の設定を保存しました" })
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "保存に失敗しました" })
    } finally {
      setIsSaving(false)
    }
  }

  const addNotice = () =>
    setSettings((s) => ({
      ...s,
      notices: [...s.notices, { id: `notice-${Date.now()}`, title: "", body: "", enabled: true }],
    }))

  const updateNotice = (id: string, patch: Partial<StatusNotice>) =>
    setSettings((s) => ({ ...s, notices: s.notices.map((n) => (n.id === id ? { ...n, ...patch } : n)) }))

  const removeNotice = (id: string) => setSettings((s) => ({ ...s, notices: s.notices.filter((n) => n.id !== id) }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          戻る
        </Button>
        <h2 className="text-xl font-semibold">運行情報の設定</h2>
        <Button onClick={save} disabled={isSaving} className="ml-auto">
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? "保存中..." : "保存"}
        </Button>
      </div>

      {message && (
        <Alert variant={message.type === "error" ? "destructive" : "default"}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <p className="text-sm text-muted-foreground">
        一般ページ「運行情報」に何を出すかを設定します。すべて掲載しない状態にすると、ページには
        「お知らせする運行情報はありません」とだけ表示されます。
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <SectionEditor
          icon={Train}
          title="列車"
          value={settings.train}
          onChange={(train) => setSettings((s) => ({ ...s, train }))}
        />
        <SectionEditor
          icon={Bus}
          title="バス"
          value={settings.bus}
          onChange={(bus) => setSettings((s) => ({ ...s, bus }))}
        />
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          「自動判定」はDynmapの実位置と時刻表の差から遅れを判定します。実位置が取得できないときは遅延なしとして扱い、
          何も掲載しません。
        </AlertDescription>
      </Alert>

      {/* デマンド運行（タクシー・渡船）の注意書き */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Car className="h-4 w-4" />
            デマンド運行（タクシー・渡船）の注意書き
          </CardTitle>
          <CardDescription>
            既定は経路検索で出しているタクシーの注意書きです。渡船など他のデマンド運行の案内も書けます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.demand.enabled}
              onChange={(e) => setSettings((s) => ({ ...s, demand: { ...s.demand, enabled: e.target.checked } }))}
            />
            運行情報ページに掲載する
          </label>
          <div className="space-y-1.5">
            <Label className="text-xs">見出し</Label>
            <Input
              value={settings.demand.title}
              onChange={(e) => setSettings((s) => ({ ...s, demand: { ...s.demand, title: e.target.value } }))}
              disabled={!settings.demand.enabled}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">本文（1行につき1項目。箇条書きで表示されます）</Label>
            <Textarea
              value={settings.demand.lines.join("\n")}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  demand: {
                    ...s.demand,
                    lines: e.target.value
                      .split("\n")
                      .map((l) => l.trim())
                      .filter(Boolean),
                  },
                }))
              }
              rows={4}
              disabled={!settings.demand.enabled}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSettings((s) => ({ ...s, demand: { ...DEFAULT_STATUS_SETTINGS.demand } }))}
          >
            既定（タクシーの注意書き）に戻す
          </Button>
        </CardContent>
      </Card>

      {/* 自由記述 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4" />
            そのほかのお知らせ（自由記述）
          </CardTitle>
          <CardDescription>イベント案内や臨時のお知らせなどを、上から順に掲載します。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings.notices.length === 0 && <p className="text-sm text-muted-foreground">お知らせはまだありません。</p>}
          {settings.notices.map((n) => (
            <div key={n.id} className="space-y-2 rounded border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={n.enabled}
                    onChange={(e) => updateNotice(n.id, { enabled: e.target.checked })}
                  />
                  掲載する
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeNotice(n.id)}
                  className="ml-auto text-destructive"
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  削除
                </Button>
              </div>
              <Input
                value={n.title}
                onChange={(e) => updateNotice(n.id, { title: e.target.value })}
                placeholder="見出し（例: 花火大会にともなう臨時列車の運転）"
              />
              <Textarea
                value={n.body}
                onChange={(e) => updateNotice(n.id, { body: e.target.value })}
                rows={3}
                placeholder="本文（改行できます）"
              />
            </div>
          ))}
          <Button type="button" variant="outline" onClick={addNotice}>
            <Plus className="mr-1 h-4 w-4" />
            お知らせを追加
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={isSaving}>
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? "保存中..." : "保存"}
        </Button>
      </div>
    </div>
  )
}
