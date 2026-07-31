"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { gtfsParser } from "@/lib/gtfs-parser"
import { stationCoordinateManager, type StationCoordinates } from "@/lib/station-coordinates"
import {
  busMapSettingsManager,
  refResiduals,
  solveBusMapTransform,
  worldToPixel,
  type BusMapRef,
  type BusMapSettings,
} from "@/lib/bus-map"
import { Trash2, Save, ArrowLeft } from "lucide-react"

// バス停マップ（背景画像＋位置合わせ）の管理画面。
//
// 使い方: public/ に路線図画像を置き、そのパスを指定 → 画像上で「基準点」にするバス停を選び、
// そのバス停がある位置をクリック。2点で概算、3点以上で最小二乗の当てはめになる。
// 残りのバス停は登録済みのワールド座標(X/Z)から自動配置される。

const shortName = (n: string) => n.replace(/^\(バス\)/, "")

export function BusMapCalibrator({ onBack }: { onBack?: () => void }) {
  const [ready, setReady] = useState(false)
  const [coords, setCoords] = useState<StationCoordinates>({})
  const [settings, setSettings] = useState<BusMapSettings>({ imageUrl: "", refs: [] })
  const [imageUrlInput, setImageUrlInput] = useState("")
  const [pickStop, setPickStop] = useState("") // これから画像上でクリックして位置を決めるバス停
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const load = async () => {
      if (!gtfsParser.hasData()) await gtfsParser.loadFromStorageAsync()
      const [c, s] = await Promise.all([stationCoordinateManager.load(), busMapSettingsManager.load()])
      setCoords(c)
      setSettings(s)
      setImageUrlInput(s.imageUrl)
      setReady(true)
    }
    load()
  }, [])

  // バス停（バス系統に現れる停の和集合）
  const busStops = useMemo(() => {
    if (!ready) return [] as string[]
    const stopName = new Map<string, string>()
    for (const s of gtfsParser.getStops()) stopName.set(s.stop_id, s.stop_name)
    const busRouteIds = new Set(gtfsParser.getRoutes().filter((r) => r.route_type === 3).map((r) => r.route_id))
    const busTripIds = new Set(gtfsParser.getTrips().filter((t) => busRouteIds.has(t.route_id)).map((t) => t.trip_id))
    const names = new Set<string>()
    for (const st of gtfsParser.getAllStopTimes()) {
      if (!busTripIds.has(st.trip_id)) continue
      const n = stopName.get(st.stop_id)
      if (n) names.add(n)
    }
    return [...names].sort((a, b) => a.localeCompare(b, "ja"))
  }, [ready])

  const transform = useMemo(() => solveBusMapTransform(settings.refs, coords), [settings.refs, coords])
  const residuals = useMemo(
    () => (transform ? refResiduals(transform, settings.refs, coords) : []),
    [transform, settings.refs, coords],
  )

  // 画像クリック → 選択中のバス停の基準点として登録（画像の実ピクセル座標に換算）
  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pickStop || !imgRef.current || !imgSize) return
    const rect = imgRef.current.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * imgSize.w
    const py = ((e.clientY - rect.top) / rect.height) * imgSize.h
    if (px < 0 || py < 0 || px > imgSize.w || py > imgSize.h) return
    setSettings((s) => ({
      ...s,
      refs: [...s.refs.filter((r) => r.name !== pickStop), { name: pickStop, px: Math.round(px), py: Math.round(py) }],
    }))
    setPickStop("")
    setMessage(null)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const next = { ...settings, imageUrl: imageUrlInput.trim() }
      await busMapSettingsManager.save(next)
      setSettings(next)
      setMessage("保存しました。/live の「地図から選ぶ」に反映されます。")
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  if (!ready) return <p className="py-12 text-center text-muted-foreground">読み込み中...</p>

  const placedStops = busStops.filter((n) => coords[n])
  const missingStops = busStops.filter((n) => !coords[n])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold">バス停マップ</h2>
          <p className="text-sm text-muted-foreground">
            路線図画像の上にバス停を重ねるための設定です。基準点を2点以上（3点以上推奨）指定すると、
            座標が登録済みのバス停は自動で配置されます。
          </p>
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
            戻る
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-medium">画像のパス</span>
          <input
            type="text"
            value={imageUrlInput}
            onChange={(e) => setImageUrlInput(e.target.value)}
            placeholder="/bus-map.png（public フォルダに置いたファイル）"
            className="h-9 w-full rounded border border-border bg-background px-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? "保存中..." : "保存"}
        </button>
      </div>

      {message && <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p>}
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <span className="text-sm font-medium">基準点にするバス停</span>
        <select
          value={pickStop}
          onChange={(e) => setPickStop(e.target.value)}
          className="h-9 rounded border border-border bg-background px-2 text-sm"
        >
          <option value="">選択してください</option>
          {placedStops.map((n) => (
            <option key={n} value={n}>
              {shortName(n)}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          {pickStop ? "→ 画像上のその位置をクリックしてください" : "座標が登録済みのバス停のみ基準点にできます"}
        </span>
      </div>

      {imageUrlInput.trim() ? (
        <div className="overflow-auto rounded-lg border border-border bg-white">
          <div className="relative inline-block" onClick={handleImageClick}>
            {/* 画像（クリックで基準点を打つ） */}
            <img
              ref={imgRef}
              src={imageUrlInput.trim()}
              alt="バス路線図"
              className={pickStop ? "block max-w-full cursor-crosshair" : "block max-w-full"}
              onLoad={(e) => setImgSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onError={() => setImgSize(null)}
            />
            {/* 重ねて表示: 基準点(赤)と、変換で自動配置されるバス停(緑) */}
            {imgSize && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
              >
                {transform &&
                  placedStops.map((n) => {
                    const p = worldToPixel(transform, coords[n].x, coords[n].z)
                    const isRef = settings.refs.some((r) => r.name === n)
                    if (isRef) return null
                    return (
                      <g key={n}>
                        <circle cx={p.x} cy={p.y} r={imgSize.w / 140} fill="#16a34a" stroke="#ffffff" strokeWidth={imgSize.w / 500} />
                        <text
                          x={p.x}
                          y={p.y + imgSize.w / 70}
                          textAnchor="middle"
                          fontSize={imgSize.w / 80}
                          fill="#14532d"
                          stroke="#ffffff"
                          strokeWidth={imgSize.w / 400}
                          paintOrder="stroke"
                        >
                          {shortName(n)}
                        </text>
                      </g>
                    )
                  })}
                {settings.refs.map((r) => (
                  <g key={r.name}>
                    <circle cx={r.px} cy={r.py} r={imgSize.w / 110} fill="#dc2626" stroke="#ffffff" strokeWidth={imgSize.w / 400} />
                    <text
                      x={r.px}
                      y={r.py - imgSize.w / 80}
                      textAnchor="middle"
                      fontSize={imgSize.w / 70}
                      fontWeight={700}
                      fill="#991b1b"
                      stroke="#ffffff"
                      strokeWidth={imgSize.w / 350}
                      paintOrder="stroke"
                    >
                      {shortName(r.name)}
                    </text>
                  </g>
                ))}
              </svg>
            )}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          画像のパスを入力すると、ここに路線図が表示されます（例: public/bus-map.png に置いて「/bus-map.png」）。
        </p>
      )}

      {/* 基準点の一覧とズレ */}
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="mb-2 text-sm font-bold">
          基準点（{settings.refs.length}）
          {settings.refs.length < 2 && <span className="ml-2 text-xs font-normal text-amber-700">2点以上で有効になります</span>}
        </p>
        {settings.refs.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだありません。</p>
        ) : (
          <ul className="space-y-1">
            {settings.refs.map((r: BusMapRef) => {
              const res = residuals.find((x) => x.name === r.name)
              return (
                <li key={r.name} className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{shortName(r.name)}</span>
                  <span className="tabular-nums text-muted-foreground">
                    ({r.px}, {r.py})
                  </span>
                  {res && (
                    <span className={`text-xs ${res.dist > 20 ? "text-amber-700" : "text-muted-foreground"}`}>
                      ズレ {Math.round(res.dist)}px
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setSettings((s) => ({ ...s, refs: s.refs.filter((x) => x.name !== r.name) }))}
                    className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted"
                    aria-label="削除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          変更は「保存」を押すまで反映されません。座標が未登録のバス停（{missingStops.length}件）は地図に配置できないため、
          管理画面「駅座標」での登録が必要です。
        </p>
      </div>
    </div>
  )
}
