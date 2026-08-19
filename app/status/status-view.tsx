"use client"

import { useEffect, useState } from "react"
import { useGtfsData } from "@/hooks/use-gtfs-data"
import { statusSettingsManager, type StatusSection, type StatusSettings } from "@/lib/status-settings"
import { detectCurrentDelays, type DelayStat, type DelaySummary } from "@/lib/status-delays"
import { Bus, Car, Info, RefreshCw, Train } from "lucide-react"

// 運行情報ページの本体。掲載内容は管理画面「運行情報」の設定に従う。
// - 掲載する(on): 管理者が書いた本文をそのまま出す
// - 掲載しない(off): 何も出さない（イベント開催時間外など）
// - 自動判定(auto): 実位置から遅れを検知したときだけ出す

const REFRESH_MS = 60000

// 自動判定の本文（遅れているときだけ返す）
function autoText(kind: "列車" | "バス", stat: DelayStat): string | null {
  if (stat.delayed === 0) return null
  return `${kind}に遅れが出ています（${stat.delayed}本、最大約${stat.maxDelay}分）。`
}

function sectionBody(section: StatusSection, kind: "列車" | "バス", delays: DelaySummary | null): string[] | null {
  if (section.mode === "off") return null
  const lines: string[] = []
  if (section.mode === "auto") {
    if (!delays) return null // 判定中
    const auto = autoText(kind, kind === "列車" ? delays.train : delays.bus)
    if (!auto) return null // 遅れていないので何も出さない
    lines.push(auto)
  }
  if (section.message.trim()) lines.push(...section.message.split("\n").filter((l) => l.trim()))
  return lines.length > 0 ? lines : null
}

function InfoCard({
  icon: Icon,
  title,
  lines,
}: {
  icon: typeof Train
  title: string
  lines: string[]
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-2 flex items-center gap-2 text-base font-bold">
        <Icon className="h-4 w-4 text-green-700" />
        {title}
      </h2>
      <div className="space-y-1 text-sm text-foreground">
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
    </div>
  )
}

export function StatusView() {
  const { dataLoaded } = useGtfsData()
  const [settings, setSettings] = useState<StatusSettings | null>(null)
  const [delays, setDelays] = useState<DelaySummary | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    statusSettingsManager.load().then(setSettings).catch(() => setSettings(null))
  }, [tick])

  // 自動判定を使う設定のときだけ実位置を見に行く
  useEffect(() => {
    if (!settings || !dataLoaded) return
    if (settings.train.mode !== "auto" && settings.bus.mode !== "auto") {
      setDelays(null)
      return
    }
    let cancelled = false
    detectCurrentDelays()
      .then((d) => {
        if (!cancelled) setDelays(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [settings, dataLoaded, tick])

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  if (!settings) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin" />
        読み込み中...
      </div>
    )
  }

  const trainLines = sectionBody(settings.train, "列車", delays)
  const busLines = sectionBody(settings.bus, "バス", delays)
  const demand = settings.demand.enabled && settings.demand.lines.length > 0 ? settings.demand : null
  const notices = settings.notices.filter((n) => n.enabled && (n.title.trim() || n.body.trim()))
  const isEmpty = !trainLines && !busLines && !demand && notices.length === 0

  return (
    <div className="space-y-4">
      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card py-16 text-center">
          <Info className="h-8 w-8 text-muted-foreground" />
          <p className="text-muted-foreground">現在、お知らせする運行情報はありません。</p>
        </div>
      ) : (
        <>
          {trainLines && <InfoCard icon={Train} title="列車" lines={trainLines} />}
          {busLines && <InfoCard icon={Bus} title="バス" lines={busLines} />}
          {demand && <InfoCard icon={Car} title={demand.title} lines={demand.lines} />}
          {notices.map((n) => (
            <InfoCard
              key={n.id}
              icon={Info}
              title={n.title || "お知らせ"}
              lines={n.body.split("\n").filter((l) => l.trim())}
            />
          ))}
        </>
      )}
    </div>
  )
}
