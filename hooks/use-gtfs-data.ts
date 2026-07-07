"use client"

import { useEffect, useState } from "react"
import { GTFSStorage } from "@/lib/gtfs-storage"
import { gtfsParser } from "@/lib/gtfs-parser"

// GTFSデータをサーバーから読み込み、読み込み状態を返す共通フック。
// gtfsParser はシングルトンなので、一度読み込めばクライアント遷移では再読み込み不要。
// /（フォーム）・/result・/timetable/[stopId] の各ページから使う。
export function useGtfsData() {
  const [dataLoaded, setDataLoaded] = useState(() => gtfsParser.hasData())
  const [isLoadingData, setIsLoadingData] = useState(() => !gtfsParser.hasData())

  useEffect(() => {
    if (gtfsParser.hasData()) {
      setDataLoaded(true)
      setIsLoadingData(false)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const hasServerData = await GTFSStorage.hasData()
        if (hasServerData) {
          const activeDataset = await GTFSStorage.getActiveDataset()
          if (activeDataset) {
            await gtfsParser.loadFromStorageAsync()
            if (!cancelled) setDataLoaded(true)
          } else if (!cancelled) {
            setDataLoaded(false)
          }
        } else if (!cancelled) {
          setDataLoaded(false)
        }
      } catch (error) {
        console.error("[v0] 初期データ読み込みエラー:", error)
        if (!cancelled) setDataLoaded(false)
      } finally {
        if (!cancelled) setIsLoadingData(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return { dataLoaded, isLoadingData }
}
