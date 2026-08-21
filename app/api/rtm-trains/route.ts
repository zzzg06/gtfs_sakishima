import { type NextRequest, NextResponse } from "next/server"

// DynmapのRTM列車マーカー(rtm_trains_set)を取得して整形して返す（公開GET）。
// Dynmap側のMod(SakishimaDynmapExtension)が列車1両=1マーカーで
// ラベル "運用番号 種別 行先"（cfg: labelFormat=%RUN_NO% %DEST%）、
// 実ワールド座標(x/y/z)・車種アイコンを出力している。
// （角括弧付き "[運用番号] …" は旧フォーマット。互換のため引き続き解釈する）
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

// マーカーのラベルを 運用番号 / 種別 / 行先 に分解する。
// MC側 cfg の display.labelFormat は "%RUN_NO% %DEST%"（角括弧は廃止）。
// 運用番号が無い車両は fallbackRunNoLabel（空白）になるため、ラベルが空白で始まる。
//
// 実際の例:
//   "K02 急行 電鉄坊崎"            → K02 / 急行 / 電鉄坊崎
//   "   渡船"                      → (なし) / (なし) / 渡船
//   "K01 急行 咲島港(咲西浜臨停)"  → K01 / 急行 / 咲島港 ＋注記「咲西浜臨停」
//   "B01 咲12_砥島ゆき"            → B01 / 咲12 / 砥島ゆき（バスは系統_行先の1トークン）
//   "[K04] 各停 中原台"            → 旧フォーマット（角括弧）も受ける
//
// - 行先末尾の括弧書き "(咲西浜臨停)" は行先そのものではなく注記なので destNote として切り出す
//   （突き合わせは注記なしの行先で行い、表示は「咲島港行き（咲西浜臨停）」とする）

// 種別だけが設定されていて行先が無いラベル（cfgの "各停" "急行" "回送" 等の単独指定）
const TYPE_ONLY = /^(回送(車)?|臨時|試運転|非営業|各停|各駅停車|急行|準急|特快|特別快速|循環|循環特快|準特急|通勤|快速)$/

// 先頭トークンが運用番号か（K02・B01・03 のように英字0〜3文字＋数字）
function looksLikeRunNo(token: string): boolean {
  return /^[A-Za-zＡ-Ｚａ-ｚ]{0,3}[0-9０-９]{1,4}$/.test(token)
}

function parseLabel(label: string): { runNo: string; type: string; dest: string; destNote: string } {
  const original = label || ""
  let rest = original.trim()
  let runNo = ""

  const bracket = /^\[(.*?)\]\s*(.*)$/.exec(rest)
  if (bracket) {
    // 旧フォーマット "[運用番号] ..."
    runNo = bracket[1].trim()
    rest = bracket[2].trim()
  } else if (!/^\s/.test(original)) {
    // 運用番号なしのラベルは fallbackRunNoLabel（空白）で始まる。
    // そうでなければ先頭トークンが運用番号か見る（後ろに行先が続く場合のみ）
    const sp = rest.search(/\s/)
    if (sp > 0) {
      const head = rest.slice(0, sp)
      if (looksLikeRunNo(head)) {
        runNo = head
        rest = rest.slice(sp + 1).trim()
      }
    }
  }

  let type = ""
  let dest = rest
  const us = rest.indexOf("_")
  if (us >= 0) {
    // バスの "系統_行先" 表記
    type = rest.slice(0, us).trim()
    dest = rest.slice(us + 1).trim()
  } else {
    const sp = rest.search(/\s/)
    if (sp >= 0) {
      type = rest.slice(0, sp).trim()
      dest = rest.slice(sp + 1).trim()
    } else if (TYPE_ONLY.test(rest)) {
      // "回送" "各停" のように種別だけのラベル
      type = rest
      dest = ""
    }
  }

  let destNote = ""
  const note = /^(.*?)[（(]([^（）()]*)[)）]\s*$/.exec(dest)
  if (note && note[1].trim()) {
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
