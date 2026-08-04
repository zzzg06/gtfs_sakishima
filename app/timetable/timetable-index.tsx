"use client"

import { useRouter } from "next/navigation"
import { TimetableSearch } from "@/components/timetable-search"
import { useGtfsData } from "@/hooks/use-gtfs-data"
import { RefreshCw } from "lucide-react"

// /timetable のインデックス。駅/停留所を選ぶと /timetable/[stopId] へ遷移。
// 名前での検索と「地図から選ぶ」はどちらも TimetableSearch が持つ（トップページと同じUI）。
export function TimetableIndex() {
  const router = useRouter()
  const { dataLoaded, isLoadingData } = useGtfsData()

  return (
    <div className="mx-auto max-w-2xl space-y-6 lg:max-w-4xl">
      <h1 className="text-2xl font-bold text-foreground">時刻表</h1>
      {isLoadingData ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin" />
          データを読み込み中...
        </div>
      ) : dataLoaded ? (
        <TimetableSearch onSelect={(stop) => router.push(`/timetable/${encodeURIComponent(stop.stop_id)}`)} />
      ) : (
        <p className="text-muted-foreground">時刻表を表示するにはデータの登録が必要です。</p>
      )}
    </div>
  )
}
