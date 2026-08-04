"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { StationCoordinates } from "@/lib/station-coordinates"
import { solveBusMapTransform, worldToPixel, type BusMapSettings } from "@/lib/bus-map"
import { Minus, Plus, RotateCcw } from "lucide-react"

// 駅・バス停を地図から選ぶピッカー（走行位置のバス停選択と、時刻表の駅選択で共用）。
// 背景画像（パンフレットの路線図）が設定されていればその上に、無ければ
// 登録済みの座標（Minecraft X/Z、管理画面「駅座標」）だけの簡易図に並べる。
// クリックでその駅／バス停を選択する。座標が未登録のものは地図に置けないため、下にボタンとして並べる。

export type StopKind = "rail" | "bus"

export interface BusMapRoute {
  name: string // 系統・路線名
  color: string
  stops: string[] // 停車順（駅名／バス停名）
}

export interface PickerStop {
  name: string
  kind: StopKind // 鉄道駅=四角、バス停=丸で描き分ける
}

interface Props {
  coords: StationCoordinates
  stops: PickerStop[] // 対象の駅・バス停
  routes: BusMapRoute[]
  selected: string
  onSelect: (name: string) => void
  busMap?: BusMapSettings // 背景画像＋位置合わせ（未設定なら座標だけの簡易図）
}

const VIEW_W = 900
const VIEW_H = 620
const PADDING = 46 // 端の停留所名がはみ出さないよう余白を取る

// 表示用の短い名前（先頭の「(バス)」を落とす）
const shortName = (n: string) => n.replace(/^\(バス\)/, "")

export function StopMapPicker({ coords, stops, routes, selected, onSelect, busMap }: Props) {
  const stopNames = useMemo(() => stops.map((s) => s.name), [stops])
  const kindOf = useMemo(() => new Map(stops.map((s) => [s.name, s.kind])), [stops])
  const [zoom, setZoom] = useState(1)
  const [hover, setHover] = useState<string | null>(null)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  // 表示幅（スマホなど狭い画面では図を縮めて全体を収める）
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [panelWidth, setPanelWidth] = useState(0)

  // 背景画像の実サイズを取得（viewBoxに使う）
  const imageUrl = busMap?.imageUrl || ""
  useEffect(() => {
    if (!imageUrl) {
      setImgSize(null)
      return
    }
    const img = new Image()
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => setImgSize(null)
    img.src = imageUrl
  }, [imageUrl])

  const transform = useMemo(
    () => (busMap && imageUrl ? solveBusMapTransform(busMap.refs || [], coords) : null),
    [busMap, imageUrl, coords],
  )
  const useImage = !!(imageUrl && imgSize && transform)

  const layout = useMemo(() => {
    const placed = stopNames.filter((n) => coords[n])
    const missing = stopNames.filter((n) => !coords[n])
    if (useImage && transform) {
      // 背景画像上へワールド座標を変換して配置する
      const pts = new Map<string, { x: number; y: number }>()
      for (const n of placed) pts.set(n, worldToPixel(transform, coords[n].x, coords[n].z))
      return { pts, missing, scale: 1 }
    }
    if (placed.length === 0) return { pts: new Map<string, { x: number; y: number }>(), missing, scale: 1 }
    const xs = placed.map((n) => coords[n].x)
    const zs = placed.map((n) => coords[n].z)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minZ = Math.min(...zs)
    const maxZ = Math.max(...zs)
    // ワールド座標(X=東, Z=南)をそのまま画面(x=右, y=下)に対応させる。縦横比は保つ。
    const scale = Math.min((VIEW_W - PADDING * 2) / Math.max(1, maxX - minX), (VIEW_H - PADDING * 2) / Math.max(1, maxZ - minZ))
    const offX = (VIEW_W - (maxX - minX) * scale) / 2
    const offY = (VIEW_H - (maxZ - minZ) * scale) / 2
    const pts = new Map<string, { x: number; y: number }>()
    for (const n of placed) {
      pts.set(n, { x: (coords[n].x - minX) * scale + offX, y: (coords[n].z - minZ) * scale + offY })
    }
    return { pts, missing, scale }
  }, [coords, stopNames, useImage, transform])

  const measure = useCallback(() => {
    const el = viewportRef.current
    if (el && el.clientWidth > 0) setPanelWidth(el.clientWidth)
  }, [])
  useEffect(() => {
    measure()
    const el = viewportRef.current
    // ResizeObserverが効かない環境（埋め込みブラウザ等）に備えて window の resize も見る
    window.addEventListener("resize", measure)
    let ro: ResizeObserver | null = null
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure)
      ro.observe(el)
    }
    return () => {
      window.removeEventListener("resize", measure)
      ro?.disconnect()
    }
  }, [measure])

  const viewW = useImage && imgSize ? imgSize.w : VIEW_W
  const viewH = useImage && imgSize ? imgSize.h : VIEW_H
  // 既定はパネル幅に収まる倍率（狭い画面ほど縮む）。ここにズームを掛ける
  const baseScale = panelWidth > 0 ? Math.min(1, panelWidth / viewW) : useImage ? Math.min(1, VIEW_W / viewW) : 1
  const width = viewW * baseScale * zoom
  const height = viewH * baseScale * zoom
  // 画像モードでは図の縮尺に合わせて丸・文字の大きさを調整する
  const k = useImage ? viewW / VIEW_W : 1

  // 停留所名は重なりを避けて置く（選択中・ホバー中は必ず出す）
  const labels = useMemo(() => {
    const boxes: { x1: number; y1: number; x2: number; y2: number }[] = []
    const out: { name: string; x: number; y: number; show: boolean }[] = []
    const entries = [...layout.pts.entries()].sort((a, b) => a[1].y - b[1].y)
    for (const [name, p] of entries) {
      const w = (shortName(name).length * 10 + 6) * k
      const box = { x1: p.x - w / 2, y1: p.y + 8 * k, x2: p.x + w / 2, y2: p.y + 24 * k }
      const hit = boxes.some((b) => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2))
      if (!hit) boxes.push(box)
      out.push({ name, x: p.x, y: p.y, show: !hit })
    }
    return out
  }, [layout, k])

  return (
    <div className="space-y-2">
      <div className="relative">
        <div ref={viewportRef} className="max-h-[520px] overflow-auto rounded-lg border border-border bg-white">
          <svg width={width} height={height} viewBox={`0 0 ${viewW} ${viewH}`}>
            {/* 背景（パンフレットの路線図） */}
            {useImage && <image href={imageUrl} x={0} y={0} width={viewW} height={viewH} />}
            {/* 系統（停車順を結んだ線）。背景画像がある場合は画像側に路線が描かれているので出さない */}
            {!useImage &&
              routes.map((r) => {
              const pts = r.stops.map((s) => layout.pts.get(s)).filter(Boolean) as { x: number; y: number }[]
              if (pts.length < 2) return null
              return (
                <polyline
                  key={r.name}
                  points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={r.color}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.35}
                />
              )
            })}

            {/* バス停 */}
            {labels.map((l) => {
              const isSel = l.name === selected
              const isHover = l.name === hover
              return (
                <g
                  key={l.name}
                  className="cursor-pointer"
                  onClick={() => onSelect(l.name)}
                  onMouseEnter={() => setHover(l.name)}
                  onMouseLeave={() => setHover((h) => (h === l.name ? null : h))}
                >
                  <title>{l.name}</title>
                  {/* クリック領域を広めに取る */}
                  <circle cx={l.x} cy={l.y} r={12 * k} fill="transparent" />
                  {/* 鉄道駅は四角、バス停は丸で描き分ける */}
                  {kindOf.get(l.name) === "rail" ? (
                    <rect
                      x={l.x - (isSel ? 8 : 6) * k}
                      y={l.y - (isSel ? 8 : 6) * k}
                      width={(isSel ? 16 : 12) * k}
                      height={(isSel ? 16 : 12) * k}
                      rx={2 * k}
                      fill={isSel ? "#1d4ed8" : "#ffffff"}
                      stroke={isSel ? "#1e3a8a" : isHover ? "#1d4ed8" : "#1f2937"}
                      strokeWidth={(isSel ? 3 : 2.5) * k}
                    />
                  ) : (
                    <circle
                      cx={l.x}
                      cy={l.y}
                      r={(isSel ? 8 : 5.5) * k}
                      fill={isSel ? "#15803d" : "#ffffff"}
                      stroke={isSel ? "#14532d" : isHover ? "#15803d" : "#475569"}
                      strokeWidth={(isSel ? 3 : 2.5) * k}
                    />
                  )}
                  {(l.show || isSel || isHover) && (
                    <text
                      x={l.x}
                      y={l.y + 20 * k}
                      textAnchor="middle"
                      fontSize={12 * k}
                      fontWeight={isSel ? 700 : 500}
                      fill={isSel ? (kindOf.get(l.name) === "rail" ? "#1d4ed8" : "#15803d") : "#1f2937"}
                      stroke="#ffffff"
                      strokeWidth={3.5 * k}
                      paintOrder="stroke"
                      className="pointer-events-none"
                    >
                      {shortName(l.name)}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        </div>

        {/* 拡大・縮小 */}
        <div className="absolute bottom-2 left-2 flex overflow-hidden rounded-lg border border-border bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3, z + 0.5))}
            className="px-2 py-1 text-slate-700 hover:bg-slate-100"
            aria-label="拡大"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
            className="border-l border-border px-2 py-1 text-slate-700 hover:bg-slate-100"
            aria-label="縮小"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="border-l border-border px-2 py-1 text-slate-700 hover:bg-slate-100"
            aria-label="表示倍率を戻す"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 凡例と使い方 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {stops.some((s) => s.kind === "rail") && (
          <span className="flex items-center gap-1.5">
            <svg width="16" height="16" viewBox="0 0 16 16">
              <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="#fff" stroke="#1f2937" strokeWidth="2.5" />
            </svg>
            鉄道駅
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="5" fill="#fff" stroke="#475569" strokeWidth="2.5" />
          </svg>
          バス停
        </span>
        <span>クリックで選択（拡大すると全ての名前が出ます）</span>
      </div>

      {/* 座標未登録で地図に置けない駅・バス停 */}
      {layout.missing.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-2">
          <p className="mb-1 text-xs text-muted-foreground">
            座標が未登録のため地図に出せない駅・バス停（{layout.missing.length}）。管理画面「駅座標」で登録すると地図に載ります。
          </p>
          <div className="flex flex-wrap gap-1">
            {layout.missing.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onSelect(n)}
                className={`rounded border px-2 py-1 text-xs ${
                  n === selected ? "border-green-700 bg-green-700 text-white" : "border-border bg-background hover:bg-accent"
                }`}
              >
                {shortName(n)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
