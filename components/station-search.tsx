"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Search, MapPin, ArrowUpDown, Clock } from "lucide-react"
import { gtfsParser, type GTFSStop } from "@/lib/gtfs-parser"
import { getRecentStopIds, addRecentStopId } from "@/lib/station-history"
import { isPoiStop, loadPois, poiToStop, searchPois } from "@/lib/poi-points"

interface StationSearchProps {
  value: string
  onChange: (value: string, stop: GTFSStop | null) => void
  placeholder: string
  label: string
  hideLabel?: boolean // コンパクト表示時はラベルを外側のチップで表現するため非表示にする
  filterStop?: (stop: GTFSStop) => boolean // 候補に出す駅の絞り込み（例: 時刻表はタクシー専用地点を除く）
  includePoi?: boolean // Dynmapのマーカー(施設・観光地など)も候補に出す（経路検索の発着のみ）
}

export function StationSearch({
  value,
  onChange,
  placeholder,
  label,
  hideLabel = false,
  filterStop,
  includePoi = false,
}: StationSearchProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchResults, setSearchResults] = useState<GTFSStop[]>([])
  const [isRecent, setIsRecent] = useState(false) // ドロップダウンが「最近利用した駅」を表示中か
  const [inputValue, setInputValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setInputValue(value)
  }, [value])

  // Dynmapのマーカー(POI)は取得に通信が要るので、候補に出す設定のときだけ先に読み込む
  useEffect(() => {
    if (includePoi) loadPois().catch(() => {})
  }, [includePoi])

  // 最近利用した駅（localStorage）を解決して返す
  const loadRecentStops = (): GTFSStop[] => {
    const stops = getRecentStopIds()
      .map((id) => gtfsParser.getStop(id))
      .filter((s): s is GTFSStop => Boolean(s))
    return (filterStop ? stops.filter(filterStop) : stops).slice(0, 6)
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !inputRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const applyFilter = (stops: GTFSStop[]) => (filterStop ? stops.filter(filterStop) : stops)

  // 駅・バス停の候補にDynmapのマーカー(POI)を足す。駅/バス停はAPI側で除外済みなので重複しない。
  const withPois = (stops: GTFSStop[], query: string): GTFSStop[] => {
    if (!includePoi) return stops
    const pois = searchPois(query).map(poiToStop)
    return [...stops, ...pois]
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setInputValue(newValue)
    onChange(newValue, null)

    if (newValue.trim().length > 0) {
      const results = withPois(applyFilter(gtfsParser.searchStops(newValue)), newValue).slice(0, 8) // Limit to 8 results
      setSearchResults(results)
      setIsRecent(false)
      setIsOpen(results.length > 0)
    } else {
      // 空欄なら「最近利用した駅」を出す
      const recent = loadRecentStops()
      setSearchResults(recent)
      setIsRecent(true)
      setIsOpen(recent.length > 0)
    }
  }

  const handleStationSelect = (stop: GTFSStop) => {
    setInputValue(stop.stop_name)
    onChange(stop.stop_name, stop)
    addRecentStopId(stop.stop_id) // よく使う駅サジェスト用に記録
    setIsOpen(false)
    setSearchResults([])
    setIsRecent(false)
  }

  const handleInputFocus = () => {
    if (inputValue.trim().length > 0) {
      const results = withPois(applyFilter(gtfsParser.searchStops(inputValue)), inputValue).slice(0, 8)
      setSearchResults(results)
      setIsRecent(false)
      setIsOpen(results.length > 0)
    } else {
      const recent = loadRecentStops()
      setSearchResults(recent)
      setIsRecent(true)
      setIsOpen(recent.length > 0)
    }
  }

  // Enterで先頭候補を確定
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && isOpen && searchResults.length > 0) {
      e.preventDefault()
      handleStationSelect(searchResults[0])
    } else if (e.key === "Escape") {
      setIsOpen(false)
    }
  }

  return (
    <div className="relative w-full">
      {!hideLabel && (
        <label htmlFor={`station-${label}`} className="block text-sm font-medium text-foreground mb-2">
          {label}
        </label>
      )}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          id={`station-${label}`}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="pl-10 bg-input border-border focus:ring-ring focus:border-ring"
          autoComplete="off"
        />
      </div>

      {isOpen && searchResults.length > 0 && (
        <Card
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1 z-50 max-h-64 overflow-y-auto shadow-lg"
        >
          <CardContent className="p-0">
            {isRecent && (
              <div className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-medium text-muted-foreground bg-muted/50 border-b border-border">
                <Clock className="h-3 w-3" />
                最近利用した駅
              </div>
            )}
            {searchResults.map((stop) => (
              <button
                key={stop.stop_id}
                onClick={() => handleStationSelect(stop)}
                className="w-full text-left px-4 py-3 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none border-b border-border last:border-b-0 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isRecent ? (
                    <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <MapPin
                      className={`h-4 w-4 flex-shrink-0 ${isPoiStop(stop) ? "text-sky-600" : "text-muted-foreground"}`}
                    />
                  )}
                  <div>
                    <p className="font-medium text-sm">
                      {stop.stop_name}
                      {/* 駅・バス停ではない地点であることを分かるようにする */}
                      {isPoiStop(stop) && (
                        <span className="ml-1.5 rounded bg-sky-100 px-1 py-0.5 text-[10px] font-medium text-sky-700">
                          地点
                        </span>
                      )}
                    </p>
                    {stop.stop_desc && <p className="text-xs text-muted-foreground">{stop.stop_desc}</p>}
                  </div>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

interface StationSelectorProps {
  fromStation: string
  toStation: string
  fromStop: GTFSStop | null
  toStop: GTFSStop | null
  onFromStationChange: (value: string, stop: GTFSStop | null) => void
  onToStationChange: (value: string, stop: GTFSStop | null) => void
  onSwapStations: () => void
}

export function StationSelector({
  fromStation,
  toStation,
  fromStop,
  toStop,
  onFromStationChange,
  onToStationChange,
  onSwapStations,
}: StationSelectorProps) {
  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardContent className="p-6">
        <div className="space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-foreground mb-2">乗換案内</h2>
            <p className="text-muted-foreground">出発駅と到着駅を選択してください</p>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1">
              <StationSearch
                value={fromStation}
                onChange={onFromStationChange}
                placeholder="出発駅を入力してください"
                label="出発駅"
              />
            </div>

            <div className="flex-shrink-0 pb-1">
              <Button
                variant="outline"
                size="sm"
                onClick={onSwapStations}
                className="rounded-full p-2 h-10 w-10 border-border hover:bg-accent hover:text-accent-foreground bg-transparent"
                disabled={!fromStation && !toStation}
              >
                <ArrowUpDown className="h-4 w-4" />
                <span className="sr-only">駅を入れ替える</span>
              </Button>
            </div>

            <div className="flex-1">
              <StationSearch
                value={toStation}
                onChange={onToStationChange}
                placeholder="到着駅を入力してください"
                label="到着駅"
              />
            </div>
          </div>

          {fromStop && toStop && (
            <div className="p-4 bg-accent/10 border border-accent/20 rounded-lg">
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-accent" />
                <span className="text-foreground">
                  <strong>{fromStop.stop_name}</strong> から <strong>{toStop.stop_name}</strong> への経路を検索できます
                </span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
