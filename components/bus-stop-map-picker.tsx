"use client"

import { useMemo, useState } from "react"
import type { StationCoordinates } from "@/lib/station-coordinates"
import { Minus, Plus, RotateCcw } from "lucide-react"

// バス停を地図から選ぶピッカー。
// 登録済みのバス停座標（Minecraft X/Z、管理画面「駅座標」）をそのまま平面図にして、
// 系統の停車順を線で結んだ簡易路線図を描く。クリックでそのバス停を選択する。
// 座標が未登録のバス停は地図に置けないため、下にボタンとして並べる。

export interface BusMapRoute {
  name: string // 系統名
  color: string
  stops: string[] // 停車順（バス停名）
}

interface Props {
  coords: StationCoordinates
  stopNames: string[] // 対象のバス停（系統に現れる停の和集合）
  routes: BusMapRoute[]
  selected: string
  onSelect: (name: string) => void
}

const VIEW_W = 900
const VIEW_H = 620
const PADDING = 46 // 端の停留所名がはみ出さないよう余白を取る

// 表示用の短い名前（先頭の「(バス)」を落とす）
const shortName = (n: string) => n.replace(/^\(バス\)/, "")

export function BusStopMapPicker({ coords, stopNames, routes, selected, onSelect }: Props) {
  const [zoom, setZoom] = useState(1)
  const [hover, setHover] = useState<string | null>(null)

  const layout = useMemo(() => {
    const placed = stopNames.filter((n) => coords[n])
    const missing = stopNames.filter((n) => !coords[n])
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
  }, [coords, stopNames])

  // 停留所名は重なりを避けて置く（選択中・ホバー中は必ず出す）
  const labels = useMemo(() => {
    const boxes: { x1: number; y1: number; x2: number; y2: number }[] = []
    const out: { name: string; x: number; y: number; show: boolean }[] = []
    const entries = [...layout.pts.entries()].sort((a, b) => a[1].y - b[1].y)
    for (const [name, p] of entries) {
      const w = shortName(name).length * 10 + 6
      const box = { x1: p.x - w / 2, y1: p.y + 8, x2: p.x + w / 2, y2: p.y + 24 }
      const hit = boxes.some((b) => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2))
      if (!hit) boxes.push(box)
      out.push({ name, x: p.x, y: p.y, show: !hit })
    }
    return out
  }, [layout])

  const width = VIEW_W * zoom
  const height = VIEW_H * zoom

  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="max-h-[520px] overflow-auto rounded-lg border border-border bg-white">
          <svg width={width} height={height} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
            {/* 系統（停車順を結んだ線） */}
            {routes.map((r) => {
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
                  <circle cx={l.x} cy={l.y} r={12} fill="transparent" />
                  <circle
                    cx={l.x}
                    cy={l.y}
                    r={isSel ? 8 : 5.5}
                    fill={isSel ? "#15803d" : "#ffffff"}
                    stroke={isSel ? "#14532d" : isHover ? "#15803d" : "#475569"}
                    strokeWidth={isSel ? 3 : 2.5}
                  />
                  {(l.show || isSel || isHover) && (
                    <text
                      x={l.x}
                      y={l.y + 20}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight={isSel ? 700 : 500}
                      fill={isSel ? "#15803d" : "#1f2937"}
                      stroke="#ffffff"
                      strokeWidth={3.5}
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

      <p className="text-xs text-muted-foreground">
        バス停をクリックすると選択します（拡大すると全ての停留所名が出ます）。地図は登録済みの座標をもとにした簡易図です。
      </p>

      {/* 座標未登録で地図に置けないバス停 */}
      {layout.missing.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-2">
          <p className="mb-1 text-xs text-muted-foreground">
            座標が未登録のため地図に出せないバス停（{layout.missing.length}）。管理画面「駅座標」で登録すると地図に載ります。
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
