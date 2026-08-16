import { type NextRequest, NextResponse } from "next/server"

// DynmapのRTM列車マーカー(rtm_trains_set)を取得して整形して返す（公開GET）。
// Dynmap側のMod(SakishimaDynmapExtension)が列車1両=1マーカーで
// ラベル "[運用番号] 種別 行先"、実ワールド座標(x/y/z)・車種アイコンを出力している。
// （旧フォーマットの「幕:行先」=幕番号表記は廃止された）
// ブラウザから直接Dynmapを叩くとCORS/証明書で詰まるため、サーバー側で取得する。

export const dynamic = "force-dynamic"

// 既定のDynmap配信元（環境変数 DYNMAP_BASE_URL で上書き可）
const DYNMAP_BASE = process.env.DYNMAP_BASE_URL || "https://meiserver.sakishima.net:60100"
const MARKER_SET_ID = process.env.RTM_MARKER_SET_ID || "rtm_trains_set"
const WORLD = process.env.RTM_WORLD || "world"

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" }

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

interface DynmapMarker {
  x: number
  y: number
  z: number
  icon?: string
  label?: string
  markup?: boolean
}

// "[運用番号] 種別 行先" を分解する。
// 実際のマーカー例: "[K04] 各停 中原台" / "[  ] 急行 電鉄坊崎(咲西浜臨停)"（運用番号は空のことがある）
// - 種別と行先は空白区切り（旧フォーマットの "_" 区切りも受ける）
// - 行先末尾の括弧書き "(咲西浜臨停)" は行先そのものではなく注記なので destNote として切り出す
//   （突き合わせは注記なしの行先で行い、表示は「電鉄坊崎行き（咲西浜臨停）」とする）
function parseLabel(label: string): { runNo: string; type: string; dest: string; destNote: string } {
  const raw = (label || "").trim()
  const m = /^\[(.*?)\]\s*(.*)$/.exec(raw)
  if (!m) return { runNo: raw, type: "", dest: "", destNote: "" }
  const runNo = m[1].trim()
  const rest = m[2].trim()
  let type = ""
  let dest = rest
  const us = rest.indexOf("_")
  if (us >= 0) {
    type = rest.slice(0, us).trim()
    dest = rest.slice(us + 1).trim()
  } else {
    // 先頭トークンを種別、残りを行先とみなす。1トークンだけのときは行先扱い（種別のみの表記は無いため）
    const sp = rest.search(/\s/)
    if (sp >= 0) {
      type = rest.slice(0, sp).trim()
      dest = rest.slice(sp + 1).trim()
    }
  }
  let destNote = ""
  const note = /^(.*?)[（(]([^（）()]*)[)）]\s*$/.exec(dest)
  if (note) {
    dest = note[1].trim()
    destNote = note[2].trim()
  }
  return { runNo, type, dest, destNote }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const world = searchParams.get("world") || WORLD
  const url = `${DYNMAP_BASE}/tiles/_markers_/marker_${world}.json`

  try {
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: `Dynmap応答エラー (${res.status})`, url },
        { status: 502, headers: CORS },
      )
    }
    const data = (await res.json()) as { sets?: Record<string, { markers?: Record<string, DynmapMarker> }> }
    const set = data.sets?.[MARKER_SET_ID]
    const markers = set?.markers || {}

    const trains = Object.entries(markers).map(([id, mk]) => {
      const { runNo, type, dest, destNote } = parseLabel(mk.label || "")
      return {
        id, // train_<UUID>
        runNo, // 運用番号
        type, // 種別（急行・各停 等）
        dest, // 行先（注記を除いた駅名）
        destNote, // 行先の注記（例「咲西浜臨停」）。表示は「電鉄坊崎行き（咲西浜臨停）」
        label: mk.label || "",
        icon: mk.icon,
        world,
        x: mk.x,
        y: mk.y,
        z: mk.z,
      }
    })

    return NextResponse.json(
      { success: true, generatedAt: new Date().toISOString(), world, count: trains.length, trains },
      { headers: CORS },
    )
  } catch (error) {
    console.error("[gtfs] rtm-trains fetch error:", error)
    return NextResponse.json(
      { success: false, error: "Dynmapマーカーの取得に失敗しました", url },
      { status: 502, headers: CORS },
    )
  }
}
