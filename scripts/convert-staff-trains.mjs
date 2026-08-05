// 鉄道スタフ(行路表 .xlsx) → data/embedded-gtfs.json 変換スクリプト
//
// 使い方:
//   node scripts/convert-staff-trains.mjs
//   node scripts/convert-staff-trains.mjs --source data/2026natsusakishima_staff_20260802_zantei.xlsx
//
// スタフの「鉄道　運用XX」ブロック(レーン=最大4便)から列車ダイヤを抽出し、
// アプリ同梱の embedded-gtfs.json(datasets形式)を1データセットで生成する。
// 2026年版は OuDia(.oud2) が無くスタフのみが原データのため、列車もここから生成する。

import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const XLSX = require("xlsx")

const args = {
  source: "data/2026natsusakishima_staff_20260802_zantei.xlsx",
  output: "data/embedded-gtfs.json",
  datasetId: "embedded-2026",
  datasetName: "2026夏スタフ",
}
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--source") args.source = process.argv[++i]
  else if (process.argv[i] === "--output") args.output = process.argv[++i]
  else if (process.argv[i] === "--name") args.datasetName = process.argv[++i]
}

const SHEETS = ["8時台", "9時台", "10時台", "11時台"]

// 駅名のひらがな読み（駅名検索用 stop_desc）。convert-oud2.mjs と同じ推定値。
const STATION_READINGS = {
  桐立: "きりたち",
  県道: "けんどう",
  小島: "こじま",
  桐立埠頭: "きりたちふとう",
  海央皇: "かいおうほう",
  島北出坂: "とうほくいでさか",
  笠丘: "かさおか",
  神在月: "かみありづき",
  木古川: "きこがわ",
  葛敷: "かつしき",
  中原台: "なかはらだい",
  大岩: "ひろいわ",
  新咲市場: "しんさきしじょう",
  咲東崎: "さきとうざき",
  天玉寺: "てんぎょくじ",
  船上湯本: "ふながみゆもと",
  上砥: "かみと",
  咲西浜: "さきさいはま",
  助が丘: "すけがおか",
  八つ橋: "やつはし",
  富田: "とみた",
  咲島港: "さきしまこう",
  豆島口: "まめじまぐち",
  兜島中央: "かぶとじまちゅうおう",
  久米浜: "くめはま",
  御東: "みとう",
}

// 正規化後の種別 → route_color（HEX RRGGBB）。未定義は既定灰。
const SYUBETSU_COLORS = {
  各駅停車: "717071",
  各停: "717071",
  普通: "717071",
  急行: "00913A",
  特別快速: "C1272D",
  特快: "C1272D",
  特急: "C1272D",
  循環特快: "C1272D",
  快速: "2563EB",
  通勤快速: "DB2777",
  通勤: "DB2777",
  準特急: "7C3AED",
  準特: "7C3AED",
  咲島循環: "00A199",
  循環: "00A199",
}
const DEFAULT_COLOR = "6B7280"

const pad2 = (n) => String(n).padStart(2, "0")

function secToTime(total) {
  const t = Math.round(total)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
}

function timeToSec(hms) {
  const [h, m, s] = hms.split(":").map(Number)
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0)
}

function fractionToTime(v) {
  if (typeof v !== "number" || !(v > 0 && v < 1)) return null
  return secToTime(v * 86400)
}

// スタフの時刻セルを分類する。
//  - 数値(0..1の小数)            → 停車時刻               { kind:"time", t }
//  - "(08:08:10)" 等の括弧時刻   → 通過(通過時刻が判明)   { kind:"passtime", t }
//  - "レ"                        → 通過(時刻なし→補間)    { kind:"pass" }
//  - "花火臨停" 等の臨時停車注記 → 通過扱い(時刻なし→補間) { kind:"pass" }
//  - 空 / その他注記             → なし                   { kind:"empty" }
function classifyCell(v) {
  if (typeof v === "number" && v > 0 && v < 1) return { kind: "time", t: fractionToTime(v) }
  const s = String(v ?? "").trim()
  if (!s) return { kind: "empty" }
  const m = s.replace(/[（）()\s]/g, "")
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(m)) {
    const [hh, mm, ss] = m.split(":")
    return { kind: "passtime", t: `${pad2(Number(hh))}:${pad2(Number(mm))}:${pad2(Number(ss || 0))}` }
  }
  if (s === "レ" || s.includes("臨停")) return { kind: "pass" }
  return { kind: "empty" }
}

// 種別欄("特別快速 関山号" / "急行 → 各駅停車" 等) → 基本種別("特別快速" / "急行")
function normalizeSyubetsu(raw) {
  const before = String(raw || "").split("→")[0].trim()
  const head = before.split(/[ 　]/)[0].trim()
  return head || "列車"
}

const wb = XLSX.readFile(path.resolve(args.source))

const stopsMap = new Map() // stop_id(駅名) -> stop
const routesMap = new Map() // 正規化種別 -> route
const trips = []
const stopTimes = []
let tripSeq = 0
let skippedShort = 0
let passCount = 0

function ensureRoute(syubetsu) {
  if (routesMap.has(syubetsu)) return routesMap.get(syubetsu).route_id
  const routeId = `RAIL_${syubetsu}`
  routesMap.set(syubetsu, {
    route_id: routeId,
    route_short_name: syubetsu,
    route_long_name: syubetsu,
    route_type: 2,
    route_color: SYUBETSU_COLORS[syubetsu] || DEFAULT_COLOR,
  })
  return routeId
}

function ensureStop(name) {
  if (!stopsMap.has(name)) {
    stopsMap.set(name, {
      stop_id: name,
      stop_name: name,
      stop_lat: 1000,
      stop_lon: 2000 * (stopsMap.size + 1),
      location_type: 0,
      parent_station: "",
      stop_desc: STATION_READINGS[name] || "",
    })
  }
  return name
}

for (const sheetName of SHEETS) {
  const ws = wb.Sheets[sheetName]
  if (!ws) continue
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" })

  const allHeads = []
  const blockStarts = []
  rows.forEach((r, i) => {
    const c0 = String(r[0] || "")
    if (/　運用/.test(c0)) allHeads.push(i)
    if (/^鉄道　運用/.test(c0)) blockStarts.push(i)
  })

  for (const H of blockStarts) {
    const next = allHeads.find((x) => x > H) ?? rows.length
    const operationNo = String(rows[H + 2]?.[1] || "").trim() // 運用番号（KX）※レーン共通

    // レーン数はブロックによって違う（基本4レーン、運用によってはそれ以上）ため、
    // 列車番号セルが埋まっている限り8列ごとに読み進める。
    const lanes = []
    for (let off = 0; off <= 96; off += 8) {
      const v = rows[H + 5]?.[off + 1]
      if (v !== "" && v != null) lanes.push(off)
    }

    for (const off of lanes) {
      const trainNoRaw = rows[H + 5]?.[off + 1]
      if (trainNoRaw === "" || trainNoRaw == null) continue
      const type = String(rows[H + 6]?.[off + 1] || "").trim()
      const dest = String(rows[H + 7]?.[off + 1] || "").trim()
      if (!type && !dest) continue

      // 停車駅・通過駅を区別して全駅を順に集める。通過(優等の駅飛ばし)も在線表示・遅延推定で
      // 必要なため stop_times に含める（pass:true）。「レ」など時刻なし通過は後で前後から補間。
      const legStops = []
      for (let r = H + 9; r < next; r++) {
        const nm = String(rows[r]?.[off] || "").trim()
        if (!nm) continue
        const ca = classifyCell(rows[r][off + 1])
        const cd = classifyCell(rows[r][off + 2])
        const trackRaw = rows[r][off + 3]
        const platform = typeof trackRaw === "number" ? String(Math.round(trackRaw)) : ""
        if (ca.kind === "time" || cd.kind === "time") {
          // 停車（着・発が数値）
          const arr = ca.t || cd.t
          const dep = cd.t || ca.t
          legStops.push({ name: nm, arr, dep, platform, pass: false })
        } else if (ca.kind === "passtime" || cd.kind === "passtime") {
          // 通過（通過時刻が判明＝括弧時刻）
          const t = ca.t || cd.t
          legStops.push({ name: nm, arr: t, dep: t, platform: "", pass: true })
        } else if (ca.kind === "pass" || cd.kind === "pass") {
          // 通過（時刻なし。後で前後の判明時刻から線形補間）
          legStops.push({ name: nm, arr: null, dep: null, platform: "", pass: true })
        }
        // それ以外（両セル空・注記行・その便が通らない駅）は除外
      }

      // 時刻なし通過(arr=null)を、前後の判明時刻の間で停車順インデックス按分により補間する。
      for (let i = 0; i < legStops.length; i++) {
        if (legStops[i].arr != null) continue
        let p = i - 1
        while (p >= 0 && legStops[p].dep == null) p--
        let q = i + 1
        while (q < legStops.length && legStops[q].arr == null) q++
        if (p < 0 || q >= legStops.length) continue // 端で補間不能（後で除外）
        const t0 = timeToSec(legStops[p].dep)
        const t1 = timeToSec(legStops[q].arr)
        const t = secToTime(t0 + ((t1 - t0) * (i - p)) / (q - p))
        legStops[i].arr = t
        legStops[i].dep = t
      }
      // 補間できなかった通過（端のレ等）は除外
      const resolvedStops = legStops.filter((s) => s.arr != null)
      if (resolvedStops.filter((s) => !s.pass).length < 2) {
        skippedShort++
        continue
      }

      const syubetsu = normalizeSyubetsu(type)
      const routeId = ensureRoute(syubetsu)
      // 進行方向: 列車番号の偶奇（奇数=下り0 / 偶数=上り1）
      const trainNum = typeof trainNoRaw === "number" ? Math.round(trainNoRaw) : Number.parseInt(String(trainNoRaw), 10)
      const direction = Number.isFinite(trainNum) ? (trainNum % 2 === 1 ? 0 : 1) : 0

      tripSeq++
      const tripId = `t2026_${tripSeq}`
      trips.push({
        route_id: routeId,
        service_id: "EVERYDAY",
        trip_id: tripId,
        trip_headsign: dest ? `${dest}行き` : "",
        trip_short_name: operationNo || String(trainNum || ""),
        train_number: Number.isFinite(trainNum) ? String(trainNum) : "",
        direction_id: direction,
      })

      resolvedStops.forEach((st, i) => {
        ensureStop(st.name)
        const entry = {
          trip_id: tripId,
          arrival_time: st.arr,
          departure_time: st.dep,
          stop_id: st.name,
          stop_sequence: i + 1,
          platform_code: st.platform,
          drop_off_type: 0,
        }
        // 通過駅は乗降不可。位置計算には使うが時刻表・経路検索からは除外するための印。
        if (st.pass) entry.pass = true
        stopTimes.push(entry)
        if (st.pass) passCount++
      })
    }
  }
}

const calendar = [
  {
    service_id: "EVERYDAY",
    monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 1, sunday: 1,
    start_date: "20260101",
    end_date: "20991231",
  },
]

const now = new Date().toISOString()
const dataset = {
  id: args.datasetId,
  name: args.datasetName,
  uploadDate: now,
  stops: Array.from(stopsMap.values()),
  routes: Array.from(routesMap.values()),
  trips,
  stopTimes,
  calendar,
}

const output = {
  generatedAt: now,
  source: path.basename(args.source),
  activeDatasetId: dataset.id,
  datasets: [dataset],
}

const outPath = path.resolve(args.output)
mkdirSync(path.dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(output, null, 1), "utf8")

console.log(`変換完了: ${outPath}`)
console.log(`  列車便 ${trips.length} / 駅 ${stopsMap.size} / 種別 ${routesMap.size} / 時刻 ${stopTimes.length}（うち通過 ${passCount}）`)
if (skippedShort) console.log(`  停車2未満でスキップ: ${skippedShort}便`)
console.log(`  種別: ${Array.from(routesMap.keys()).join(", ")}`)
console.log(`  アクティブ: ${dataset.id} (${dataset.name})`)
