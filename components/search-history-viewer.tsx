"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ArrowLeft, RefreshCw, Trash2, History, TrendingUp } from "lucide-react"
import { loadSearchLog, clearSearchLog, type SearchLogEntry } from "@/lib/search-log"

interface SearchHistoryViewerProps {
  onBack: () => void
}

export function SearchHistoryViewer({ onBack }: SearchHistoryViewerProps) {
  const [entries, setEntries] = useState<SearchLogEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setIsLoading(true)
    setError(null)
    try {
      setEntries(await loadSearchLog())
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleClear = async () => {
    if (!confirm("検索履歴をすべて削除しますか？この操作は取り消せません。")) return
    try {
      await clearSearchLog()
      setEntries([])
    } catch (err) {
      alert(err instanceof Error ? err.message : "削除に失敗しました")
    }
  }

  // 運用別の検索回数を集計
  const tripRanking = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>()
    for (const entry of entries) {
      for (const trip of entry.trips) {
        const label = [trip.tripShortName, trip.routeName && `(${trip.routeName})`, trip.headsign && `${trip.headsign}`]
          .filter(Boolean)
          .join(" ")
        const key = trip.tripShortName || trip.routeName || trip.headsign || "不明"
        const display = label || key
        const existing = counts.get(key)
        if (existing) existing.count++
        else counts.set(key, { label: display, count: 1 })
      }
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count)
  }, [entries])

  // 区間別（出発→到着）の検索回数を集計
  const odRanking = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of entries) {
      const key = `${entry.from} → ${entry.to}`
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
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
          <h2 className="text-xl font-semibold">検索履歴</h2>
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
        全セッションの検索 {entries.length.toLocaleString()} 件を記録しています（直近1000件まで）。
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              よく検索される運用
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tripRanking.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">データがありません</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {tripRanking.map((item, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}.</span>
                      <span className="truncate">{item.label}</span>
                    </span>
                    <Badge variant="secondary" className="flex-shrink-0">
                      {item.count}回
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
              <TrendingUp className="h-4 w-4" />
              よく検索される区間
            </CardTitle>
          </CardHeader>
          <CardContent>
            {odRanking.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">データがありません</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {odRanking.map((item, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}.</span>
                      <span className="truncate">{item.label}</span>
                    </span>
                    <Badge variant="secondary" className="flex-shrink-0">
                      {item.count}回
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            最近の検索
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">検索履歴がありません</p>
          ) : (
            <div className="max-h-[28rem] overflow-y-auto rounded border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium whitespace-nowrap">日時</th>
                    <th className="px-3 py-2 font-medium">区間</th>
                    <th className="px-3 py-2 font-medium">運用</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.slice(0, 200).map((entry, i) => (
                    <tr key={i} className="border-t border-border align-top">
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{formatDate(entry.ts)}</td>
                      <td className="px-3 py-1.5">
                        {entry.from} → {entry.to}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {entry.trips.length === 0 ? (
                            <span className="text-xs text-muted-foreground">該当なし</span>
                          ) : (
                            entry.trips.map((t, j) => (
                              <Badge key={j} variant="outline" className="text-[10px] px-1.5 py-0">
                                {t.tripShortName || t.routeName || t.headsign}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
