"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { TimetableResults } from "@/components/timetable-search"
import { useGtfsData } from "@/hooks/use-gtfs-data"
import { gtfsParser } from "@/lib/gtfs-parser"
import { Button } from "@/components/ui/button"
import { ArrowLeft, RefreshCw } from "lucide-react"

// 時刻表本体（クライアント）。タイトルはページ側の generateMetadata が担当する。
export function TimetableView() {
  const params = useParams()
  const router = useRouter()
  const { isLoadingData } = useGtfsData()

  const stopId = decodeURIComponent(String(params.stopId || ""))
  const stop = !isLoadingData ? gtfsParser.getStop(stopId) : undefined

  if (isLoadingData) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin" />
        データを読み込み中...
      </div>
    )
  }

  if (!stop) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 text-center">
        <p className="text-muted-foreground">指定された駅・バス停が見つかりませんでした。</p>
        <Link href="/">
          <Button variant="outline">
            <ArrowLeft className="mr-1 h-4 w-4" />
            トップに戻る
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <TimetableResults
      stop={stop}
      onBack={() => router.push("/")}
      onStation={(s) => router.push(`/timetable/${encodeURIComponent(s.stop_id)}`)}
    />
  )
}
