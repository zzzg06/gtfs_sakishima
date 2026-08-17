"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useIsMobile } from "@/hooks/use-mobile"
import { getCachedStationCoordinates, stationCoordinateManager } from "@/lib/station-coordinates"
import { buildDynmapUrl } from "@/lib/dynmap-link"
import { ExternalLink, Map as MapIcon } from "lucide-react"

// 駅の登録座標(station-coordinates)からDynmapの周辺地図を開くボタン。
// PCは画面内のダイアログにDynmapを埋め込み（別タブで開くリンクも併記）、
// モバイルは埋め込みが重いのでそのまま別タブへ。座標が未登録の駅では何も出さない。
export function NearbyMapButton({
  stationName,
  className,
}: {
  stationName: string
  className?: string
}) {
  const isMobile = useIsMobile()
  const [coord, setCoord] = useState<{ x: number; z: number } | null>(
    () => getCachedStationCoordinates()[stationName] ?? null,
  )
  const [open, setOpen] = useState(false)

  // 座標は共有設定から読む。既に読み込み済みならキャッシュを使うので追加の通信はしない。
  useEffect(() => {
    let cancelled = false
    const cached = getCachedStationCoordinates()[stationName]
    if (cached) {
      setCoord(cached)
      return
    }
    stationCoordinateManager
      .load()
      .then((all) => {
        if (!cancelled) setCoord(all[stationName] ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [stationName])

  if (!coord) return null

  const linkUrl = buildDynmapUrl(coord.x, coord.z, { zoom: 5 })
  const embedUrl = buildDynmapUrl(coord.x, coord.z, { zoom: 5, nogui: true })
  const cls =
    className ??
    "inline-flex items-center gap-0.5 rounded border border-sky-600 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 transition-colors hover:bg-sky-50"

  // モバイルは埋め込まず別タブ
  if (isMobile) {
    return (
      <a
        href={linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
        title={`${stationName} の周辺地図（Dynmap）を開く`}
      >
        <MapIcon className="h-3 w-3" />
        周辺地図
      </a>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cls}
        title={`${stationName} の周辺地図（Dynmap）を見る`}
      >
        <MapIcon className="h-3 w-3" />
        周辺地図
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* 既定の sm:max-w-lg を上書きするため sm: 付きで指定する */}
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span>{stationName} の周辺地図</span>
              <a
                href={linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                別タブで開く
              </a>
            </DialogTitle>
          </DialogHeader>
          {/* Dynmapをそのまま埋め込む。読み込めない場合に備えて「別タブで開く」を上に置いている */}
          <iframe
            src={embedUrl}
            title={`${stationName} の周辺地図`}
            className="h-[60vh] w-full rounded border border-border"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <p className="text-xs text-muted-foreground">
            地図はサーバーのDynmapです（座標 X {Math.round(coord.x)} / Z {Math.round(coord.z)}）。
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
