"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { RouteResults } from "@/components/route-results"
import { SearchForm, type SearchMode, type SearchFormInitial } from "@/components/search-form"
import { useRouteSearch } from "@/hooks/use-route-search"
import { useGtfsData } from "@/hooks/use-gtfs-data"
import { useIsMobile } from "@/hooks/use-mobile"
import { gtfsParser, type GTFSStop } from "@/lib/gtfs-parser"
import { getPoiByName, loadPois, poiToStop } from "@/lib/poi-points"
import { buildResultUrl, buildShareUrl, parseSearch, type SearchType } from "@/lib/search-query"
import { Button } from "@/components/ui/button"
import { ArrowLeft, RefreshCw } from "lucide-react"

const TYPE_TO_MODE: Record<SearchType, SearchMode> = { dep: "departure", arr: "arrival", none: "none" }
const MODE_TO_TYPE: Record<SearchMode, SearchType> = { departure: "dep", arrival: "arr", none: "none" }

function findStopByName(name: string): GTFSStop | null {
  if (!name) return null
  const stop = gtfsParser.getStops().find((s) => s.stop_name === name)
  if (stop) return stop
  // Dynmapのマーカー(POI)を発着に指定した検索。名前で引き当てる
  const poi = getPoiByName(name)
  return poi ? poiToStop(poi) : null
}

// 結果画面の本体（クライアント）。タイトルはページ側の generateMetadata が担当する。
export function ResultView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { dataLoaded, isLoadingData } = useGtfsData()
  const { routes, isLoading, error, hasSearched, query, canEarlier, canLater, searchRoutes, goEarlier, goLater } =
    useRouteSearch()
  const isMobile = useIsMobile()
  const [formOpen, setFormOpen] = useState(false)

  const key = searchParams.toString()
  const parsed = useMemo(() => parseSearch(new URLSearchParams(key)), [key])

  // URLの検索条件が変わる／データ準備完了で検索を実行
  useEffect(() => {
    if (!dataLoaded || !parsed) return
    let cancelled = false
    // POIが発着に含まれるURLでも復元できるよう、マーカーを読み込んでから解決する
    loadPois()
      .catch(() => {})
      .then(() => {
        if (cancelled) return
        runSearch()
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded, key])

  const runSearch = () => {
    if (!parsed) return
    const fs = findStopByName(parsed.from)
    const ts = findStopByName(parsed.to)
    if (!fs || !ts) return
    const mode = TYPE_TO_MODE[parsed.type]
    const time = parsed.type === "none" ? "" : `${parsed.time.slice(0, 2)}:${parsed.time.slice(2, 4)}`
    searchRoutes(fs, ts, mode, time, parsed.options)
    setFormOpen(false)
  }

  const initial: SearchFormInitial | null = useMemo(() => {
    if (!parsed) return null
    const now = new Date()
    return {
      from: parsed.from,
      to: parsed.to,
      mode: TYPE_TO_MODE[parsed.type],
      hour: parsed.time.slice(0, 2) || now.getHours().toString().padStart(2, "0"),
      minute: parsed.time.slice(2, 4) || now.getMinutes().toString().padStart(2, "0"),
      options: parsed.options,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // 共有リンク。検索条件を1つのトークンに詰めた短縮URL(/r/<token>)を使う。
  // 出発指定のときは表示中の先頭経路の発時刻に差し替えて、
  // 「1本前/1本後」で送ったあとの並びも共有先で再現できるようにする。
  const shareUrl = useMemo(() => {
    if (!parsed) return ""
    const first = routes[0]
    const time =
      parsed.type === "dep" && first ? first.departureTime.slice(0, 5).replace(":", "") : parsed.time
    return buildShareUrl(parsed.from, parsed.to, parsed.type, time, parsed.options)
  }, [parsed, routes])

  const handleSubmit = (
    fromStop: GTFSStop,
    toStop: GTFSStop,
    mode: SearchMode,
    hour: string,
    minute: string,
    options: import("@/lib/route-finder").TransportOptions,
  ) => {
    router.push(buildResultUrl(fromStop.stop_name, toStop.stop_name, MODE_TO_TYPE[mode], `${hour}${minute}`, options))
  }

  if (isLoadingData) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin" />
        データを読み込み中...
      </div>
    )
  }

  if (!parsed || !initial) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 text-center">
        <p className="text-muted-foreground">検索条件が指定されていません。</p>
        <Link href="/">
          <Button variant="outline">
            <ArrowLeft className="mr-1 h-4 w-4" />
            検索に戻る
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* PCはサイドメニューで移動できるため「トップ」ボタンはモバイルのみ */}
      <div className="flex justify-start lg:hidden">
        <Link href="/">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            トップ
          </Button>
        </Link>
      </div>

      {/* PCは2カラム（左:検索フォーム常時表示・sticky／右:結果）。モバイルは折りたたみフォーム＋結果の縦積み。 */}
      <div className="lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="lg:sticky lg:top-6">
          <SearchForm
            key={key}
            initial={initial}
            collapsible={isMobile}
            open={isMobile ? formOpen : undefined}
            onOpenChange={setFormOpen}
            className="w-full"
            onSubmit={handleSubmit}
          />
        </div>

        <div className="mt-6 lg:mt-0">
          <RouteResults
            routes={routes}
            isLoading={isLoading}
            error={error}
            hasSearched={hasSearched}
            query={query}
            canEarlier={canEarlier}
            canLater={canLater}
            onEarlier={goEarlier}
            onLater={goLater}
            onNewSearch={() => {
              setFormOpen(true)
              window.scrollTo({ top: 0, behavior: "smooth" })
            }}
            onStationClick={(stop) => router.push(`/timetable/${encodeURIComponent(stop.stop_id)}`)}
            shareUrl={shareUrl}
          />
        </div>
      </div>
    </div>
  )
}
