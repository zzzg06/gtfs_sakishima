"use client"

import { useRouter } from "next/navigation"
import { SearchForm, type SearchMode } from "@/components/search-form"
import { TimetableSearch } from "@/components/timetable-search"
import { NoDataMessage } from "@/components/no-data-message"
import { AuthProvider, useAuth } from "@/lib/auth"
import { useGtfsData } from "@/hooks/use-gtfs-data"
import { buildResultUrl, DEFAULT_OPTIONS, type SearchType } from "@/lib/search-query"
import type { GTFSStop } from "@/lib/gtfs-parser"
import type { TransportOptions } from "@/lib/route-finder"
import { Button } from "@/components/ui/button"
import { Settings, Train, ExternalLink, CircleHelp } from "lucide-react"

const MODE_TO_TYPE: Record<SearchMode, SearchType> = { departure: "dep", arrival: "arr", none: "none" }

function HomePage() {
  const { dataLoaded, isLoadingData } = useGtfsData()
  const { admin, isLoading: authLoading } = useAuth()
  const router = useRouter()

  const handleGoToAdmin = () => router.push("/admin")

  const now = new Date()
  const initial = {
    from: "",
    to: "",
    mode: "departure" as SearchMode,
    hour: now.getHours().toString().padStart(2, "0"),
    minute: now.getMinutes().toString().padStart(2, "0"),
    options: DEFAULT_OPTIONS,
  }

  const handleSubmit = (
    fromStop: GTFSStop,
    toStop: GTFSStop,
    mode: SearchMode,
    hour: string,
    minute: string,
    options: TransportOptions,
  ) => {
    router.push(buildResultUrl(fromStop.stop_name, toStop.stop_name, MODE_TO_TYPE[mode], `${hour}${minute}`, options))
  }

  if (isLoadingData) {
    return (
      <main className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-foreground mb-4 text-balance">関南乗換案内</h1>
            <p className="text-lg text-muted-foreground">データを読み込み中...</p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {admin && (
          <div className="flex justify-end mb-4">
            <Button variant="outline" onClick={handleGoToAdmin} className="flex items-center gap-2 bg-transparent">
              <Settings className="h-4 w-4" />
              管理者ページ
            </Button>
          </div>
        )}

        {/* PCはサイドメニューにブランドがあるため、ヒーローは控えめに */}
        <div className="mb-6 text-center lg:mb-8 lg:text-left">
          <h1 className="mb-2 text-3xl font-bold text-foreground text-balance lg:mx-auto lg:max-w-5xl">
            関南乗換案内
          </h1>
          <p className="mx-auto max-w-2xl text-muted-foreground text-pretty lg:mx-auto lg:max-w-5xl">
            咲島の鉄道・バスをまとめて検索できる乗換案内です。咲島祭でもご利用いただけます。
            {dataLoaded ? "駅と時刻を選んで経路を検索してください。" : "経路検索を利用するにはデータの登録が必要です。"}
          </p>
        </div>

        {dataLoaded ? (
          <div className="space-y-8">
            {/* PCは2カラム（左:検索フォーム／右:走行位置・時刻表・咲島祭）。モバイルは縦積み。 */}
            <div className="mx-auto max-w-5xl lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start lg:gap-6">
              <div className="lg:sticky lg:top-6">
                <SearchForm initial={initial} onSubmit={handleSubmit} className="w-full" />
              </div>

              {/* 走行位置・時刻表・咲島祭リンク（走行位置はPCではサイドメニューにあるため非表示） */}
              <div className="mt-6 space-y-4 lg:mt-0">
                <a
                  href="/live"
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-green-700 bg-card py-2.5 text-sm font-bold text-green-700 transition-colors hover:bg-green-50 lg:hidden"
                >
                  <Train className="h-4 w-4" />
                  列車走行位置（在線）を見る
                </a>

                {/* 使い方（PCはサイドメニューにあるためモバイルのみ） */}
                <a
                  href="/help"
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent lg:hidden"
                >
                  <CircleHelp className="h-4 w-4" />
                  はじめての方へ（使い方）
                </a>

                <TimetableSearch onSelect={(stop) => router.push(`/timetable/${encodeURIComponent(stop.stop_id)}`)} />

                <a
                  href="https://boxjapan.info"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-orange-500 py-3 text-base font-bold text-white transition-colors hover:bg-orange-600"
                >
                  咲島祭参加はこちらから
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>

            {/* PCはサイドメニュー最下部に管理者ログインがあるため非表示 */}
            {!admin && !authLoading && (
              <div className="text-center lg:hidden">
                <Button
                  variant="outline"
                  onClick={handleGoToAdmin}
                  className="flex items-center gap-2 mx-auto bg-transparent"
                >
                  <Settings className="h-4 w-4" />
                  管理者ログイン
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <NoDataMessage onShowAdminPanel={handleGoToAdmin} showAdminButton={true} />
            {!admin && !authLoading && (
              <div className="text-center">
                <Button
                  variant="outline"
                  onClick={handleGoToAdmin}
                  className="flex items-center gap-2 mx-auto bg-transparent"
                >
                  <Settings className="h-4 w-4" />
                  管理者ログイン
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <HomePage />
    </AuthProvider>
  )
}
