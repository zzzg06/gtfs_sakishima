import { type NextRequest, NextResponse } from "next/server"

// Dynmapのマーカー（施設・観光地など）を検索地点(POI)として使えるように整形して返す（公開GET）。
// 駅・バス停は既にGTFS側にあるため、セットごと除外する（EXCLUDED_SETS）。
// ブラウザから直接Dynmapを叩くとCORS/証明書で詰まるため、サーバー側で取得する。

export const dynamic = "force-dynamic"

const DYNMAP_BASE = process.env.DYNMAP_BASE_URL || "https://meiserver.sakishima.net:60100"
const WORLD = process.env.RTM_WORLD || "world"

// 検索地点にしないマーカーセット。
// station/busstop: GTFSの駅・バス停と重複する。railway/busway: 路線のライン。
// rtm_trains_set: 列車の現在位置。markers: 既定の空セット。
// event: [2-4]イベント・体験は開催時限りの地点なので検索候補にしない。
const EXCLUDED_SETS = new Set(["station", "busstop", "railway", "busway", "rtm_trains_set", "markers", "event"])

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" }
const CACHE_TTL_MS = 60000

export interface DynmapPoi {
  id: string // poi:<セットID>:<マーカーID>
  setId: string
  category: string // セットのラベル（例「[3-1]食事・売店」）
  name: string // マーカー名から種別の接頭辞「(食事)」を外したもの
  rawName: string // マーカー名そのまま
  kind: string // 接頭辞から取れる種別（例「食事」）。無ければ空
  x: number
  z: number
}

let cache: { at: number; pois: DynmapPoi[] } | null = null

// Dynmapのラベルは "&#xff5e;" のように数値文字参照でエスケープされていることがある
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

// マーカー名は "(食事)えんぺら〜" のように種別が接頭辞で付く。表示用に種別と名称へ分ける。
function splitName(label: string): { name: string; kind: string } {
  const raw = decodeEntities((label || "").trim()).trim()
  const m = /^[（(]([^（）()]*)[)）]\s*(.*)$/.exec(raw)
  if (m && m[2].trim()) return { name: m[2].trim(), kind: m[1].trim() }
  return { name: raw, kind: "" }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const world = searchParams.get("world") || WORLD
  const url = `${DYNMAP_BASE}/tiles/_markers_/marker_${world}.json`

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(
      { success: true, cached: true, count: cache.pois.length, pois: cache.pois },
      { headers: CORS },
    )
  }

  try {
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: `Dynmap応答エラー (${res.status})`, url },
        { status: 502, headers: CORS },
      )
    }
    const data = (await res.json()) as {
      sets?: Record<string, { label?: string; markers?: Record<string, { label?: string; x: number; z: number }> }>
    }
    const pois: DynmapPoi[] = []
    for (const [setId, set] of Object.entries(data.sets || {})) {
      if (EXCLUDED_SETS.has(setId)) continue
      for (const [markerId, mk] of Object.entries(set.markers || {})) {
        const { name, kind } = splitName(mk.label || "")
        if (!name) continue
        pois.push({
          id: `poi:${setId}:${markerId}`,
          setId,
          category: set.label || setId,
          name,
          rawName: decodeEntities((mk.label || "").trim()),
          kind,
          x: mk.x,
          z: mk.z,
        })
      }
    }
    cache = { at: Date.now(), pois }
    return NextResponse.json({ success: true, count: pois.length, pois }, { headers: CORS })
  } catch (error) {
    console.error("[gtfs] dynmap-markers fetch error:", error)
    return NextResponse.json(
      { success: false, error: "Dynmapマーカーの取得に失敗しました", url },
      { status: 502, headers: CORS },
    )
  }
}
