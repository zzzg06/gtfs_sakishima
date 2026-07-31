"use client"

import { useState, useCallback, useMemo } from "react"
import { routeFinder, type TransitRoute, type TransportOptions } from "@/lib/route-finder"
import { gtfsParser } from "@/lib/gtfs-parser"
import { delayManager } from "@/lib/delay-manager"
import { routeSettingsManager } from "@/lib/route-settings"
import { vehicleManager } from "@/lib/vehicle-manager"
import { logSearch, type SearchLogTrip } from "@/lib/search-log"
import type { GTFSStop } from "@/lib/gtfs-parser"

export type SearchMode = "departure" | "arrival" | "none"

// 1ページに表示する経路数（候補を絞る）
const PAGE_SIZE = 3

export interface RouteQuery {
  fromName: string
  toName: string
  mode: SearchMode
  time: string // "HH:MM"（mode==="none"のときは空）
}

export interface RouteSearchState {
  routes: TransitRoute[]
  isLoading: boolean
  error: string | null
  hasSearched: boolean
  query: RouteQuery | null
  canEarlier: boolean // 1本前があるか
  canLater: boolean // 1本後があるか
  paged: boolean
}

function timeToMinutes(timeStr: string): number {
  const [hours, minutes, seconds] = timeStr.split(":").map(Number)
  return hours * 60 + (minutes || 0) + (seconds || 0) / 60
}

// 経路内で同じ便(base_trip_id)に2回以上乗る候補を除外する。
// 「降りて歩いて同じ便に乗り直す」「一度降りて同じ列車に戻る」等の無意味な経路を排除する。
function hasDuplicateTrip(route: TransitRoute): boolean {
  const seen = new Set<string>()
  for (const s of route.segments) {
    if (s.type !== "transit") continue
    const id = gtfsParser.getBaseTripId(s.trip.trip_id)
    if (seen.has(id)) return true
    seen.add(id)
  }
  return false
}

// 表示中の経路から検索ログ用の運用一覧を抽出（重複除外）
function extractLoggedTrips(routes: TransitRoute[]): SearchLogTrip[] {
  const trips: SearchLogTrip[] = []
  const seen = new Set<string>()
  for (const route of routes) {
    for (const segment of route.segments) {
      // 繰り返し展開の複製便は基本便として記録（同一運用を重複させない）
      const baseId = segment.type === "transit" ? segment.trip.base_trip_id ?? segment.trip.trip_id : ""
      if (segment.type === "transit" && !seen.has(baseId)) {
        seen.add(baseId)
        trips.push({
          routeName: segment.route.route_short_name || segment.route.route_long_name,
          tripShortName: segment.trip.trip_short_name,
          headsign: segment.trip.trip_headsign,
        })
      }
    }
  }
  return trips
}

// 乗換ルートを「乗換回数・乗車する種別の並び」ごとに最良の1件へ集約する。
// 同じ種別の並び（例: 各停→循環）の便が時刻違いで複数あっても1件だけ残す（到着が早い→出発が遅い順で最良）。
function dedupeByTransitPattern(routes: TransitRoute[]): TransitRoute[] {
  const best = new Map<string, TransitRoute>()
  for (const r of routes) {
    const key = r.segments
      .map((s) => (s.type === "transit" ? s.route.route_id : "walk"))
      .join(">")
    const cur = best.get(key)
    if (!cur) {
      best.set(key, r)
      continue
    }
    const ra = timeToMinutes(r.arrivalTime)
    const ca = timeToMinutes(cur.arrivalTime)
    // 到着が早い方を優先。同着なら出発が遅い（＝待ち時間が短い）方を採用
    if (ra < ca || (ra === ca && timeToMinutes(r.departureTime) > timeToMinutes(cur.departureTime))) {
      best.set(key, r)
    }
  }
  return [...best.values()]
}

// 検索結果を「到着が早い順」に並べた表示リストと、初期表示位置（offset）を作る。
// 出発指定時は、指定時刻以降の便を offset 以降に置きつつ、それより前の便も view 前方に含めて
// 「1本前」でたどれるようにする（乗換回数は順位に考慮しない）。
function routeHasBus(r: TransitRoute): boolean {
  return r.segments.some((s) => s.type === "transit" && s.route.route_type === 3)
}

function buildView(
  candidates: TransitRoute[],
  mode: SearchMode,
  time: string,
  preferBus = false,
): { view: TransitRoute[]; offset: number } {
  const arr = (r: TransitRoute) => timeToMinutes(r.arrivalTime)
  const dep = (r: TransitRoute) => timeToMinutes(r.departureTime)
  // 到着が早い順。同着なら出発が遅い＝所要が短い方を上位に。さらに同じなら乗換が少ない順。
  const byArrival = (a: TransitRoute, b: TransitRoute) =>
    arr(a) - arr(b) || dep(b) - dep(a) || a.transfers - b.transfers
  // バス優先: バスを含む経路を上位に、その中は到着順
  const busFirst = (a: TransitRoute, b: TransitRoute) => (routeHasBus(b) ? 1 : 0) - (routeHasBus(a) ? 1 : 0)
  const byPref = preferBus ? (a: TransitRoute, b: TransitRoute) => busFirst(a, b) || byArrival(a, b) : byArrival

  if (mode === "arrival" && time) {
    // 到着指定：目標時刻までに着く便を、到着が遅い順（目標に近い順）に
    const target = timeToMinutes(time)
    const byArrLate = (a: TransitRoute, b: TransitRoute) => arr(b) - arr(a)
    const cmp = preferBus ? (a: TransitRoute, b: TransitRoute) => busFirst(a, b) || byArrLate(a, b) : byArrLate
    const view = candidates.filter((r) => arr(r) <= target).sort(cmp)
    return { view, offset: 0 }
  }

  if (mode === "departure" && time) {
    // 出発指定：指定時刻以降を前方（offset以降）に、それより前の便を後方に置き「1本前」で戻れるように
    const target = timeToMinutes(time)
    const forward = candidates.filter((r) => dep(r) >= target).sort(byPref)
    const earlier = candidates.filter((r) => dep(r) < target).sort(byPref)
    return { view: [...earlier, ...forward], offset: earlier.length }
  }

  // 指定なし：到着が早い順（＝最速で着く順）に全便
  return { view: candidates.slice().sort(byPref), offset: 0 }
}

export function useRouteSearch() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [query, setQuery] = useState<RouteQuery | null>(null)

  // 到着が早い順に並べた表示リストと、その表示開始位置
  const [view, setView] = useState<TransitRoute[]>([])
  const [offset, setOffset] = useState(0)

  const searchRoutes = useCallback(
    async (fromStop: GTFSStop, toStop: GTFSStop, mode: SearchMode, time: string, options?: TransportOptions) => {
      setIsLoading(true)
      setError(null)

      try {
        // 検索前に運用表示設定・徒歩設定・駅座標をサーバーから取得（route-finderがキャッシュを参照する）
        await Promise.all([
          delayManager.loadTripVisibilitySettings(),
          routeSettingsManager.loadAll(),
          vehicleManager.loadCache(),
        ])

        // 直通便（発車ボード）＋乗り換え経路を候補に。乗換回数は問わず到着が早い順で並べる
        const searchTime = mode === "none" || mode === "arrival" ? undefined : time
        const direct = routeFinder.getDepartureBoard(fromStop.stop_id, toStop.stop_id, options)

        // 1回乗り換え。見つからなければ2回乗り換えまで探索（直通も1回乗換も無い区間向け）
        let transferRoutes = routeFinder.findRoutesWithOneTransfer(fromStop.stop_id, toStop.stop_id, searchTime, options)
        if (transferRoutes.length === 0) {
          transferRoutes = routeFinder.findRoutesWithTwoTransfers(fromStop.stop_id, toStop.stop_id, searchTime, options)
        }
        // 徒歩区間リストに基づく経路（徒歩のみ／徒歩+列車）。徒歩オフ時は除外
        const allowWalking = options?.allowWalking !== false
        const walkRoutes = allowWalking
          ? routeFinder.findRoutesWithWalking(fromStop.stop_id, toStop.stop_id, searchTime, options)
          : []
        // 乗物→駅間徒歩→乗物（例: 鉄道→徒歩→バス）。同一駅乗換でも両端徒歩でも拾えない乗継を補う
        const transitWalkRoutes = allowWalking
          ? routeFinder.findRoutesWithTransitWalkTransit(fromStop.stop_id, toStop.stop_id, searchTime, options)
          : []

        // タクシー（デマンド）。路線図に描かれた区間のみ。タクシーオフ時は空
        const taxiRoutes = routeFinder.findRoutesWithTaxi(fromStop.stop_id, toStop.stop_id, searchTime, options)

        // 乗換・徒歩は「乗換回数・種別/徒歩の並び」ごとに最良1件へ集約
        const transfers = dedupeByTransitPattern([...transferRoutes, ...walkRoutes, ...transitWalkRoutes, ...taxiRoutes])

        // 同一便への乗り直し等、同じ便に2回乗る無意味な候補を除外
        const candidates = [...direct, ...transfers].filter((r) => !hasDuplicateTrip(r))

        const { view: v, offset: initialOffset } = buildView(candidates, mode, time, options?.preferBus === true)

        setView(v)
        setOffset(initialOffset)
        setQuery({ fromName: fromStop.stop_name, toName: toStop.stop_name, mode, time })
        setHasSearched(true)

        // 検索を記録（管理者が後で集計・閲覧できる）。表示中のページ分を記録
        logSearch({
          from: fromStop.stop_name,
          to: toStop.stop_name,
          mode,
          time,
          trips: extractLoggedTrips(v.slice(initialOffset, initialOffset + PAGE_SIZE)),
        })
      } catch (err) {
        console.error("[gtfs] Route search error:", err)
        setError("経路検索中にエラーが発生しました。もう一度お試しください。")
        setView([])
        setHasSearched(true)
      } finally {
        setIsLoading(false)
      }
    },
    [],
  )

  const goEarlier = useCallback(() => {
    setOffset((o) => Math.max(0, o - 1))
  }, [])

  const goLater = useCallback(() => {
    setOffset((o) => (o + PAGE_SIZE < view.length ? o + 1 : o))
  }, [view.length])

  const clearResults = useCallback(() => {
    setView([])
    setOffset(0)
    setHasSearched(false)
    setError(null)
    setQuery(null)
  }, [])

  const routes = useMemo(() => view.slice(offset, offset + PAGE_SIZE), [view, offset])

  const state: RouteSearchState = {
    routes,
    isLoading,
    error,
    hasSearched,
    query,
    canEarlier: offset > 0,
    canLater: offset + PAGE_SIZE < view.length,
    paged: view.length > PAGE_SIZE,
  }

  return { ...state, searchRoutes, clearResults, goEarlier, goLater }
}
