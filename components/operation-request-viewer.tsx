"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ArrowLeft, RefreshCw, Trash2, Inbox, TrendingUp } from "lucide-react"
import { loadOperationRequests, clearOperationRequests, type OperationRequestEntry } from "@/lib/operation-request"

interface OperationRequestViewerProps {
  onBack: () => void
}

const AUTO_REFRESH_MS = 20000 // 自動更新間隔

export function OperationRequestViewer({ onBack }: OperationRequestViewerProps) {
  const [entries, setEntries] = useState<OperationRequestEntry[]>([])
  const [ttlMinutes, setTtlMinutes] = useState(30)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { entries, ttlMinutes } = await loadOperationRequests()
      setEntries(entries)
      setTtlMinutes(ttlMinutes)
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, AUTO_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const handleClear = async () => {
    if (!confirm("運用リクエストをすべて削除しますか？この操作は取り消せません。")) return
    try {
      await clearOperationRequests()
      setEntries([])
    } catch (err) {
      alert(err instanceof Error ? err.message : "削除に失敗しました")
    }
  }

  // 運用別の集計（件数・最新時刻・メッセージ）
  const ranking = useMemo(() => {
    const map = new Map<
      string,
      { tripShortName: string; routeName?: string; headsign?: string; count: number; lastTs: string; messages: string[] }
    >()
    for (const e of entries) {
      const key = e.tripShortName
      const existing = map.get(key)
      if (existing) {
        existing.count++
        if (e.ts > existing.lastTs) existing.lastTs = e.ts
        if (e.message) existing.messages.push(e.message)
      } else {
        map.set(key, {
          tripShortName: e.tripShortName,
          routeName: e.routeName,
          headsign: e.headsign,
          count: 1,
          lastTs: e.ts,
          messages: e.message ? [e.message] : [],
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count || (a.lastTs < b.lastTs ? 1 : -1))
  }, [entries])

  const formatDate = (ts: string) =>
    new Date(ts).toLocaleString("ja-JP", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            戻る
          </Button>
          <h2 className="text-xl font-semibold">運用リクエスト</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
            更新
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            className="text-red-600 hover:text-red-700"
            disabled={entries.length === 0}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            クリア
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <p className="text-sm text-muted-foreground">
        利用者が検索結果の運用をタップして送ったリクエストです。直近 {ttlMinutes} 分のみ表示し、それより古いものは自動的に消去されます（{Math.round(AUTO_REFRESH_MS / 1000)}秒ごとに自動更新）。現在 {entries.length} 件。
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              運用別リクエスト
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ranking.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">リクエストはありません</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {ranking.map((item, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 text-sm">
                    <span className="flex items-start gap-2 min-w-0">
                      <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}.</span>
                      <span className="min-w-0">
                        <span className="font-medium">{item.tripShortName}</span>
                        {(item.routeName || item.headsign) && (
                          <span className="text-xs text-muted-foreground ml-1">
                            ({[item.routeName, item.headsign].filter(Boolean).join(" ")})
                          </span>
                        )}
                        <span className="block text-xs text-muted-foreground">最終: {formatDate(item.lastTs)}</span>
                      </span>
                    </span>
                    <Badge variant="secondary" className="flex-shrink-0">
                      {item.count}件
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Inbox className="h-4 w-4" />
              最近のリクエスト
            </CardTitle>
          </CardHeader>
          <CardContent>
            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">リクエストはありません</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {entries.map((e, i) => (
                  <div key={i} className="rounded border border-border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">運用 {e.tripShortName}</span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(e.ts)}</span>
                    </div>
                    {(e.routeName || e.headsign) && (
                      <p className="text-xs text-muted-foreground">
                        {[e.routeName, e.headsign].filter(Boolean).join(" ")}
                      </p>
                    )}
                    {e.message && <p className="mt-1 text-sm">{e.message}</p>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
