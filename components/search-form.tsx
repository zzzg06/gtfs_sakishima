"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { StationSearch } from "@/components/station-search"
import { gtfsParser, type GTFSStop } from "@/lib/gtfs-parser"
import { getPoiByName, loadPois, poiToStop } from "@/lib/poi-points"
import type { TransportOptions } from "@/lib/route-finder"
import { Train, ArrowUpDown, Search, ChevronDown, ChevronUp } from "lucide-react"

export type SearchMode = "departure" | "arrival" | "none"

export interface SearchFormInitial {
  from: string
  to: string
  mode: SearchMode
  hour: string
  minute: string
  options: TransportOptions
}

interface SearchFormProps {
  initial: SearchFormInitial
  // 結果画面では折りたたみ表示（サマリバー＋展開）。トップページでは常時展開。
  collapsible?: boolean
  // 折りたたみ開閉を親から制御したい場合（結果画面の「再検索」でフォームを開く等）
  open?: boolean
  onOpenChange?: (open: boolean) => void
  // 外枠のクラス（2カラムでは列幅に合わせるため差し替える）。既定は中央寄せの単一カラム。
  className?: string
  onSubmit: (
    fromStop: GTFSStop,
    toStop: GTFSStop,
    mode: SearchMode,
    hour: string,
    minute: string,
    options: TransportOptions,
  ) => void
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex flex-shrink-0 items-center justify-center w-14 px-2 py-1.5 text-xs font-medium text-white bg-gray-500 rounded">
      {children}
    </span>
  )
}

// 名称からGTFS駅/停留所、またはDynmapのマーカー(POI)を解決（URL/初期値の復元用）
function findStopByName(name: string): GTFSStop | null {
  if (!name) return null
  const stop = gtfsParser.getStops().find((s) => s.stop_name === name)
  if (stop) return stop
  const poi = getPoiByName(name)
  return poi ? poiToStop(poi) : null
}

export function SearchForm({
  initial,
  collapsible = false,
  open,
  onOpenChange,
  className = "w-full max-w-2xl mx-auto",
  onSubmit,
}: SearchFormProps) {
  const [fromStation, setFromStation] = useState(initial.from)
  const [toStation, setToStation] = useState(initial.to)
  const [fromStop, setFromStop] = useState<GTFSStop | null>(() => findStopByName(initial.from))
  const [toStop, setToStop] = useState<GTFSStop | null>(() => findStopByName(initial.to))
  const [mode, setMode] = useState<SearchMode>(initial.mode)
  const [hour, setHour] = useState(initial.hour)
  const [minute, setMinute] = useState(initial.minute)
  const [options, setOptions] = useState<TransportOptions>(initial.options)
  const [validationError, setValidationError] = useState<string | null>(null)
  // 折りたたみの開閉。トップページ（collapsible=false）は常に開いた状態で扱う。
  // open が渡されたら親制御、なければ内部state。
  const [internalOpen, setInternalOpen] = useState(!collapsible)
  const formOpen = open ?? internalOpen
  const setFormOpen = (v: boolean) => {
    onOpenChange?.(v)
    if (open === undefined) setInternalOpen(v)
  }

  // POI(Dynmapマーカー)は非同期で読み込むため、初期値がPOI名のときは読み込み後に解決し直す
  useEffect(() => {
    if ((initial.from && !fromStop) || (initial.to && !toStop)) {
      loadPois()
        .then(() => {
          if (initial.from && !fromStop) setFromStop(findStopByName(initial.from))
          if (initial.to && !toStop) setToStop(findStopByName(initial.to))
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.from, initial.to])

  const handleFromStationChange = (value: string, stop: GTFSStop | null) => {
    setFromStation(value)
    setFromStop(stop)
    setValidationError(null)
  }
  const handleToStationChange = (value: string, stop: GTFSStop | null) => {
    setToStation(value)
    setToStop(stop)
    setValidationError(null)
  }
  const handleSwapStations = () => {
    setFromStation(toStation)
    setToStation(fromStation)
    setFromStop(toStop)
    setToStop(fromStop)
    setValidationError(null)
  }
  const updateOption = (patch: Partial<TransportOptions>) => {
    setOptions((prev) => ({ ...prev, ...patch }))
    setValidationError(null)
  }

  // 時刻ショートカット: 現在時刻 / ±10分
  const setNowTime = () => {
    const d = new Date()
    setHour(d.getHours().toString().padStart(2, "0"))
    setMinute(d.getMinutes().toString().padStart(2, "0"))
  }
  const shiftTime = (deltaMin: number) => {
    let total = (Number.parseInt(hour, 10) || 0) * 60 + (Number.parseInt(minute, 10) || 0) + deltaMin
    total = ((total % 1440) + 1440) % 1440
    setHour(Math.floor(total / 60).toString().padStart(2, "0"))
    setMinute((total % 60).toString().padStart(2, "0"))
  }

  const handleSearch = () => {
    if (!fromStop || !toStop) return
    const sameStation =
      fromStop.stop_id === toStop.stop_id || gtfsParser.getRelatedStopIds(fromStop.stop_id).includes(toStop.stop_id)
    if (sameStation) {
      setValidationError("出発駅と到着駅が同じです。異なる駅を選択してください。")
      return
    }
    setValidationError(null)
    if (collapsible) setFormOpen(false)
    onSubmit(fromStop, toStop, mode, hour, minute, options)
  }

  // 時刻モードの意味を明示する補助文
  const modeHelp =
    mode === "arrival"
      ? "指定時刻までに到着する便を表示します。"
      : mode === "none"
        ? "時刻を指定せず、全便を早く着く順に表示します。"
        : "指定時刻以降に出発する便を表示します。"

  const canSearch = Boolean(fromStop && toStop)
  const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"))
  const minutes = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, "0"))
  const timeDisabled = mode === "none"
  const selectClass =
    "h-9 rounded border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-green-600 disabled:opacity-50 [&>option]:bg-background [&>option]:text-foreground"

  return (
    <div className={`overflow-hidden rounded-lg border border-border shadow-sm ${className}`}>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setFormOpen(!formOpen)}
          className="flex w-full items-center justify-between gap-2 bg-green-700 px-4 py-2.5 text-left text-white"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Train className="h-5 w-5 shrink-0" />
            <span className="truncate text-sm font-bold">
              {fromStation || "出発"} → {toStation || "到着"}
              {mode !== "none" && (
                <span className="ml-1 font-normal opacity-90">
                  {hour}:{minute}
                  {mode === "arrival" ? "着" : "発"}
                </span>
              )}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
            {formOpen ? (
              <>
                閉じる
                <ChevronUp className="h-4 w-4" />
              </>
            ) : (
              <>
                条件変更
                <ChevronDown className="h-4 w-4" />
              </>
            )}
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-2 bg-green-700 px-4 py-2.5 text-white">
          <Train className="h-5 w-5" />
          <span className="text-base font-bold">乗換案内</span>
        </div>
      )}

      {formOpen && (
        <div className="space-y-3 bg-card p-4">
          {/* 出発・到着 */}
          <div className="flex items-stretch gap-2">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <FieldLabel>出発</FieldLabel>
                <div className="flex-1">
                  <StationSearch
                    value={fromStation}
                    onChange={handleFromStationChange}
                    placeholder="駅、バス停、施設"
                    label="出発駅"
                    hideLabel
                    includePoi
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <FieldLabel>到着</FieldLabel>
                <div className="flex-1">
                  <StationSearch
                    value={toStation}
                    onChange={handleToStationChange}
                    placeholder="駅、バス停、施設"
                    label="到着駅"
                    hideLabel
                    includePoi
                  />
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleSwapStations}
              disabled={!fromStation && !toStation}
              className="flex w-10 flex-shrink-0 items-center justify-center rounded border border-border bg-white text-gray-600 transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
              aria-label="出発と到着を入れ替える"
            >
              <ArrowUpDown className="h-4 w-4" />
            </button>
          </div>

          {/* 日時 */}
          <div className="flex flex-wrap items-center gap-2">
            <FieldLabel>日時</FieldLabel>
            <select
              value={hour}
              onChange={(e) => setHour(e.target.value)}
              disabled={timeDisabled}
              className={selectClass}
              aria-label="時"
            >
              {hours.map((h) => (
                <option key={h} value={h}>
                  {h}時
                </option>
              ))}
            </select>
            <select
              value={minute}
              onChange={(e) => setMinute(e.target.value)}
              disabled={timeDisabled}
              className={selectClass}
              aria-label="分"
            >
              {minutes.map((m) => (
                <option key={m} value={m}>
                  {m}分
                </option>
              ))}
            </select>
            {/* 時刻ショートカット（60択セレクトを補助） */}
            <div className="flex items-center gap-1">
              {(
                [
                  ["現在", setNowTime],
                  ["−10分", () => shiftTime(-10)],
                  ["+10分", () => shiftTime(10)],
                ] as [string, () => void][]
              ).map(([labelText, fn]) => (
                <button
                  key={labelText}
                  type="button"
                  onClick={fn}
                  disabled={timeDisabled}
                  className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                >
                  {labelText}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 pl-1 text-sm">
              {(
                [
                  ["departure", "出発", "指定時刻以降の便"],
                  ["arrival", "到着", "指定時刻までに着く便"],
                  ["none", "指定なし", "時刻を問わず早い順"],
                ] as [SearchMode, string, string][]
              ).map(([value, labelText, tip]) => (
                <label key={value} title={tip} className="flex cursor-pointer items-center gap-1">
                  <input
                    type="radio"
                    name="search-mode"
                    checked={mode === value}
                    onChange={() => setMode(value)}
                    className="accent-green-700"
                  />
                  {labelText}
                </label>
              ))}
            </div>
          </div>
          {/* 時刻モードの意味を明示 */}
          <p className="pl-1 text-xs text-muted-foreground sm:pl-16">{modeHelp}</p>

          {/* 利用する交通手段 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <FieldLabel>手段</FieldLabel>
            <label
              title="駅間の徒歩移動を含める（バス停への乗り換えなど）。オフにすると徒歩を含む経路を除外します。"
              className="flex cursor-pointer items-center gap-1 text-sm"
            >
              <input
                type="checkbox"
                checked={options.allowWalking}
                onChange={(e) => updateOption({ allowWalking: e.target.checked })}
                className="accent-green-700"
              />
              徒歩
            </label>
            <label
              title="バス路線を経路に含める。オフにするとバスを含む経路を除外します。"
              className="flex cursor-pointer items-center gap-1 text-sm"
            >
              <input
                type="checkbox"
                checked={options.allowBus}
                onChange={(e) =>
                  updateOption(e.target.checked ? { allowBus: true } : { allowBus: false, preferBus: false })
                }
                className="accent-green-700"
              />
              バス
            </label>
            <label
              title={
                options.allowBus
                  ? "バスを使う経路を結果の上位に表示します。"
                  : "「バス」をオンにすると使えます。"
              }
              className={`flex items-center gap-1 text-sm ${options.allowBus ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
            >
              <input
                type="checkbox"
                checked={options.allowBus ? options.preferBus || false : false}
                disabled={!options.allowBus}
                onChange={(e) => updateOption({ preferBus: e.target.checked })}
                className="accent-green-700"
              />
              バス優先
            </label>
            <label
              title="タクシーを経路に含める（時刻に関係なく利用できる区間）。"
              className="flex cursor-pointer items-center gap-1 text-sm"
            >
              <input
                type="checkbox"
                checked={options.allowTaxi || false}
                onChange={(e) => updateOption({ allowTaxi: e.target.checked })}
                className="accent-green-700"
              />
              タクシー
            </label>
          </div>

          {/* 表示オプション（交通手段とは別扱い） */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <FieldLabel>表示</FieldLabel>
            <label
              title="運休の便も結果に含めて表示します（経路の絞り込みではなく表示の設定です）。"
              className="flex cursor-pointer items-center gap-1 text-sm"
            >
              <input
                type="checkbox"
                checked={options.showExcludedTrips || false}
                onChange={(e) => updateOption({ showExcludedTrips: e.target.checked })}
                className="accent-green-700"
              />
              運休も表示
            </label>
          </div>

          {/* 検索ボタン */}
          <button
            type="button"
            onClick={handleSearch}
            disabled={!canSearch}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-orange-500 py-3 text-base font-bold text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Search className="h-5 w-5" />
            検索
          </button>
          {!canSearch && <p className="text-center text-xs text-muted-foreground">出発駅と到着駅を選択してください</p>}
          {validationError && <p className="text-center text-sm font-medium text-destructive">{validationError}</p>}
        </div>
      )}
    </div>
  )
}
