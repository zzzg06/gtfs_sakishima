// バス行路表(.xlsx) → data/embedded-bus.json 変換スクリプト
//
// 使い方:
//   node scripts/convert-bus.mjs
//   node scripts/convert-bus.mjs --source data/2024natsusakishima_staff_20240502.xlsx
//   node scripts/convert-bus.mjs --include-deadhead   (回送/送り込みも含める。出入は既定で営業扱い)
//
// 行路表の「バス　運用XX」ブロック(レーン=便。4レーンが基本だが5レーン以上もある)から、停留所と時刻を抽出。
// 停留所名は徒歩リストの「(バス)〇〇」表記に合わせる（表記揺れはALIASで吸収）。

import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const XLSX = require("xlsx")

const args = { source: "data/2026natsusakishima_staff_20260802_zantei.xlsx", output: "data/embedded-bus.json", includeDeadhead: false }
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--source") args.source = process.argv[++i]
  else if (process.argv[i] === "--output") args.output = process.argv[++i]
  else if (process.argv[i] === "--include-deadhead") args.includeDeadhead = true
}

// 行路表の停留所名 → 正規名（徒歩リストの「(バス)」を除いた名前）への表記揺れ吸収
const ALIAS = {
  出坂駅東口: "島北出坂駅東口",
  出坂駅西口: "島北出坂駅西口",
  灯台公園: "咲東崎灯台公園",
  高速木古川入: "高速木古川入口",
  旧港駅跡: "元港駅跡", // 行路表の誤植（正しくは元港駅跡）
}

// バス停のひらがな読み（入力補助用、stop_descに格納）。キーはALIAS適用後の正規名。
// 推定値（ユーザー未確認）。鉄道側 convert-oud2.mjs の STATION_READINGS と同方針。
const STOP_READINGS = {
  咲島港駅: "さきしまこうえき",
  咲島港駅前: "さきしまこうえきまえ",
  豆島渡船入口: "まめじまとせんいりぐち",
  豆島渡船前: "まめじまとせんまえ",
  大学西門: "だいがくにしもん",
  大学裏: "だいがくうら",
  大学寮横: "だいがくりょうよこ",
  咲島インター: "さきしまいんたー",
  咲島農協前: "さきしまのうきょうまえ",
  咲島ﾊﾞｽﾀｰﾐﾅﾙ: "さきしまばすたーみなる",
  咲島営業所: "さきしまえいぎょうしょ",
  木古川駅東口: "きこがわえきひがしぐち",
  木古川駅西口: "きこがわえきにしぐち",
  高速木古川入口: "こうそくきこがわいりぐち",
  高速海央皇: "こうそくかいおうほう",
  湊大橋西詰: "みなとおおはしにしづめ",
  助浜交差点: "すけはまこうさてん",
  助が丘駅南口: "すけがおかえきみなみぐち",
  助が丘駅北口: "すけがおかえききたぐち",
  助が丘団地裏: "すけがおかだんちうら",
  富田駅前: "とみたえきまえ",
  大岩駅入口: "ひろいわえきいりぐち",
  新咲市場: "しんさきしじょう",
  咲東崎灯台公園: "さきとうざきとうだいこうえん",
  咲東崎灯台: "さきとうざきとうだい",
  笠丘駅前: "かさおかえきまえ",
  笠丘駅入口: "かさおかえきいりぐち",
  入九葉神社前: "いりくようじんじゃまえ",
  茶の畑: "ちゃのはた",
  出坂団地北: "いでさかだんちきた",
  島北出坂駅東口: "とうほくいでさかえきひがしぐち",
  島北出坂駅西口: "とうほくいでさかえきにしぐち",
  上砥駅前: "かみとえきまえ",
  長池貯水池: "ながいけちょすいち",
  寺見: "てらみ",
  天玉寺: "てんぎょくじ",
  天玉寺駅前: "てんぎょくじえきまえ",
  寺前海岸: "てらまえかいがん",
  影崎: "かげさき",
  福田: "ふくだ",
  中原台駅前: "なかはらだいえきまえ",
  八つ橋駅前: "やつはしえきまえ",
  葛敷一丁目: "かつしきいっちょうめ",
  咲西浜: "さきさいはま",
  下砥: "しもと",
  中砥: "なかと",
  船上湯本駅前: "ふながみゆもとえきまえ",
  砥島: "としま",
  上瀬橋: "かみせばし",
  木置: "きおき",
  出浦: "いでうら",
  // 2026夏スタフで追加された停留所
  なみなかアリーナ: "なみなかありーな",
  元港駅跡: "もとこうえきあと", // 行路表の「旧港駅跡」はALIASでこちらへ統一
  ノーエンズ農園: "のーえんずのうえん",
  咲島警察署: "さきしまけいさつしょ",
  咲島BT: "さきしまばすたーみなる",
  葛敷駅入口: "かつしきえきいりぐち",
}

const SHEETS = ["8時台", "9時台", "10時台", "11時台"]

function fractionToTime(v) {
  if (typeof v !== "number") return null
  const total = Math.round(v * 86400)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, "0")
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function canonicalStop(name) {
  // 半角カナ(ﾉｰｴﾝｽﾞ等)を全角へ正規化(NFKC)してから表記揺れ吸収
  const trimmed = String(name || "").normalize("NFKC").trim()
  const base = ALIAS[trimmed] || trimmed
  return `(バス)${base}`
}

const wb = XLSX.readFile(path.resolve(args.source))

const stopsMap = new Map() // stop_id -> stop
const routesMap = new Map() // route_id -> route
const trips = []
const stopTimes = []
let tripSeq = 0
let skippedDeadhead = 0

for (const sheetName of SHEETS) {
  const ws = wb.Sheets[sheetName]
  if (!ws) continue
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" })

  const blockStarts = []
  const allHeads = []
  rows.forEach((r, i) => {
    const c0 = String(r[0] || "")
    if (/　運用/.test(c0)) allHeads.push(i)
    if (/^バス　運用/.test(c0)) blockStarts.push(i)
  })

  for (const H of blockStarts) {
    const next = allHeads.find((x) => x > H) ?? rows.length

    // 行の位置はスタフの版によって変わる（2026-08版で「放送コマンド」行が増えた）ため、
    // 固定オフセットではなくA列の見出しで行を探す。
    const findRow = (label) => {
      for (let r = H + 1; r < next; r++) {
        if (String(rows[r]?.[0] || "").replace(/\s/g, "") === label) return r
      }
      return -1
    }
    const rowOperation = findRow("運用番号")
    const rowTrainNo = findRow("列車番号")
    const rowType = findRow("種別")
    const rowDest = findRow("行先")
    // 停車行は「着時刻」ヘッダー行の次から
    let rowHeader = -1
    for (let r = H + 1; r < next; r++) {
      if (String(rows[r]?.[1] || "").trim() === "着時刻") {
        rowHeader = r
        break
      }
    }
    if (rowTrainNo < 0 || rowType < 0 || rowDest < 0 || rowHeader < 0) continue
    const operationNo = String(rows[rowOperation]?.[1] || "").trim() // 運用番号（バスN）※レーン共通

    // レーン数はブロックによって違う（4レーンが基本だが5レーン以上の運用もある）ため、
    // 列車番号セルが埋まっている限り8列ごとに読み進める。
    const lanes = []
    for (let off = 0; off <= 96; off += 8) {
      if (String(rows[rowTrainNo]?.[off + 1] || "").trim()) lanes.push(off)
    }

    for (const off of lanes) {
      const trainNo = String(rows[rowTrainNo]?.[off + 1] || "").trim()
      if (!trainNo) continue
      const type = String(rows[rowType]?.[off + 1] || "").trim()
      const dest = String(rows[rowDest]?.[off + 1] || "").trim()

      // 回送・送り込みは非営業として除外。出入(出入庫)は途中停留所で客扱いする営業運用なので含める
      // （例: 「出入08 → 咲71」は出庫後に咲71として営業）。
      if (!args.includeDeadhead && /回送|送り込み/.test(type)) {
        skippedDeadhead++
        continue
      }

      const legStops = []
      for (let r = rowHeader + 1; r < next; r++) {
        const nm = String(rows[r]?.[off] || "").trim()
        if (!nm) continue
        const arr = fractionToTime(rows[r][off + 1])
        const dep = fractionToTime(rows[r][off + 2])
        if (!arr && !dep) continue
        legStops.push({ stopId: canonicalStop(nm), arr: arr || dep, dep: dep || arr })
      }
      if (legStops.length < 2) continue

      // 系統（種別の先頭トークン）でルート分け
      const route = type || "バス"
      const routeId = `BUS_${route}`
      if (!routesMap.has(routeId)) {
        routesMap.set(routeId, {
          route_id: routeId,
          route_short_name: route,
          route_long_name: `バス ${route}`,
          route_type: 3,
          route_color: "4080FF",
        })
      }

      tripSeq++
      const tripId = `bus_${trainNo}_${tripSeq}`
      trips.push({
        route_id: routeId,
        service_id: "EVERYDAY",
        trip_id: tripId,
        trip_headsign: `${dest}行き`,
        trip_short_name: operationNo || trainNo,
        direction_id: 0,
      })

      legStops.forEach((st, i) => {
        if (!stopsMap.has(st.stopId)) {
          const base = st.stopId.replace(/^\(バス\)/, "")
          stopsMap.set(st.stopId, {
            stop_id: st.stopId,
            stop_name: st.stopId,
            stop_lat: 0,
            stop_lon: 0,
            location_type: 0,
            parent_station: "",
            stop_desc: STOP_READINGS[base] || "",
          })
        }
        stopTimes.push({
          trip_id: tripId,
          arrival_time: st.arr,
          departure_time: st.dep,
          stop_id: st.stopId,
          stop_sequence: i + 1,
          platform_code: "",
          drop_off_type: 0,
        })
      })
    }
  }
}

const calendar = [
  {
    service_id: "EVERYDAY",
    monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 1, sunday: 1,
    start_date: "20240101",
    end_date: "20991231",
  },
]

const output = {
  generatedAt: new Date().toISOString(),
  source: path.basename(args.source),
  stops: Array.from(stopsMap.values()),
  routes: Array.from(routesMap.values()),
  trips,
  stopTimes,
  calendar,
}

const outPath = path.resolve(args.output)
mkdirSync(path.dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(output, null, 1), "utf8")

console.log(`変換完了: ${outPath}`)
console.log(`  バス便 ${trips.length} / 停留所 ${stopsMap.size} / 系統 ${routesMap.size} / 時刻 ${stopTimes.length}`)
if (skippedDeadhead) console.log(`  非営業(回送/送り込み)で除外: ${skippedDeadhead}便（--include-deadhead で含める）`)
console.log(`  系統: ${Array.from(routesMap.keys()).map((r) => r.replace("BUS_", "")).join(", ")}`)
