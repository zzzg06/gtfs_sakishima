// OuDiaSecond (.oud2) → GTFSDataset JSON 変換スクリプト
//
// 使い方:
//   node scripts/convert-oud2.mjs
//   node scripts/convert-oud2.mjs --dia "夏本番ダイヤ,2025新ダイヤ構想" --active "夏本番ダイヤ"
//   node scripts/convert-oud2.mjs --source data/2025natsusakishima.oud2 --list   (ダイヤ一覧表示)
//   node scripts/convert-oud2.mjs --include-kaisou                               (回送列車も含める)
//
// 出力: data/embedded-gtfs.json （アプリにバンドルされる同梱ダイヤデータ）

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import process from "node:process"

// ---------- 設定 ----------

const DEFAULT_SOURCE = "data/2025natsusakishima.oud2"
const DEFAULT_OUTPUT = "data/embedded-gtfs.json"
const DEFAULT_DIA_NAMES = ["2025基本列車", "2025新ダイヤ構想"]
const DEFAULT_ACTIVE_DIA = "2025新ダイヤ構想"

// 駅名のひらがな表記（駅名検索用 stop_desc）。架空駅のため推定読み。要確認・適宜修正。
const STATION_READINGS = {
  桐立: "きりたち",
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

// ---------- 引数処理 ----------

function parseArgs(argv) {
  const args = { source: DEFAULT_SOURCE, output: DEFAULT_OUTPUT, diaNames: DEFAULT_DIA_NAMES, active: DEFAULT_ACTIVE_DIA, includeKaisou: false, list: false }
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--source": args.source = argv[++i]; break
      case "--output": args.output = argv[++i]; break
      case "--dia": args.diaNames = argv[++i].split(",").map((s) => s.trim()).filter(Boolean); break
      case "--active": args.active = argv[++i]; break
      case "--include-kaisou": args.includeKaisou = true; break
      case "--list": args.list = true; break
      default: console.warn(`不明なオプション: ${argv[i]}`)
    }
  }
  return args
}

// ---------- oud2 パーサ ----------
// oud2 は「ノード名.」で開始、「.」で終了するブロックと「キー=値」行の階層テキスト形式

function parseOud2(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/)
  let pos = 0

  function parseNode(name) {
    const node = { name, props: {}, children: [] }
    while (pos < lines.length) {
      const line = lines[pos]
      if (line === ".") {
        pos++
        return node
      }
      const eq = line.indexOf("=")
      if (eq >= 0) {
        const key = line.slice(0, eq)
        const value = line.slice(eq + 1)
        if (node.props[key] === undefined) node.props[key] = value
        pos++
      } else if (line.endsWith(".") && line.length > 1) {
        pos++
        node.children.push(parseNode(line.slice(0, -1)))
      } else {
        pos++
      }
    }
    return node
  }

  const root = { name: "root", props: {}, children: [] }
  while (pos < lines.length) {
    const line = lines[pos]
    const eq = line.indexOf("=")
    if (eq >= 0) {
      root.props[line.slice(0, eq)] = line.slice(eq + 1)
      pos++
    } else if (line.endsWith(".") && line.length > 1) {
      pos++
      root.children.push(parseNode(line.slice(0, -1)))
    } else {
      pos++
    }
  }
  return root
}

// ---------- 時刻パース ----------
// oud2の時刻は HMM / HHMM / HMMSS / HHMMSS の数字列

function parseOudTime(digits) {
  if (!/^\d{3,6}$/.test(digits)) return null
  let h, m, s = 0
  switch (digits.length) {
    case 3: h = +digits.slice(0, 1); m = +digits.slice(1); break
    case 4: h = +digits.slice(0, 2); m = +digits.slice(2); break
    case 5: h = +digits.slice(0, 1); m = +digits.slice(1, 3); s = +digits.slice(3); break
    case 6: h = +digits.slice(0, 2); m = +digits.slice(2, 4); s = +digits.slice(4); break
  }
  if (m > 59 || s > 59) return null
  const pad = (n) => String(n).padStart(2, "0")
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

// EkiJikoku の1駅分エントリをパース
// 形式: "" | "3" | "2" | "1;発" | "1;着/発" | "1;着/" | "2;通過時刻" など
function parseJikokuEntry(entry) {
  if (!entry) return null
  const semi = entry.indexOf(";")
  const status = Number.parseInt(semi >= 0 ? entry.slice(0, semi) : entry, 10)
  if (status !== 1) return null // 1=停車 のみ採用（2=通過, 3=経由なし は除外）
  if (semi < 0) return null // 停車だが時刻情報なし
  const timePart = entry.slice(semi + 1).split("$")[0]
  let arr = null
  let dep = null
  if (timePart.includes("/")) {
    const [a, d] = timePart.split("/")
    arr = a ? parseOudTime(a) : null
    dep = d ? parseOudTime(d) : null
  } else {
    dep = parseOudTime(timePart)
  }
  if (!arr && !dep) return null
  if (!arr) arr = dep
  if (!dep) dep = arr
  return { arr, dep }
}

// RessyaTrack の1駅分エントリから番線番号(V)を取得（"2" / "0;2/4" / "1;1/2$..." など）
// OuDiaSecondの番線値は「1始まりの番線番号」で、0は「主本線(DownMain/UpMain)を使う」を意味する。
// （実データ全停車駅で検証済み: 0始まり解釈だと121件が範囲外、この解釈だと0件）
function parseTrackValue(entry) {
  if (!entry) return null
  const n = Number.parseInt(entry, 10)
  return Number.isNaN(n) ? null : n
}

// 番線値Vと駅の主本線から、番線リストへの0始まりインデックスを解決する
function resolveTrackIndex(value, mainTrack1Based) {
  if (value === null) return null
  if (value > 0) return value - 1 // 1始まり番線番号 → 0始まりインデックス
  // V=0 → 主本線（DownMain/UpMain も1始まり）
  return mainTrack1Based != null && mainTrack1Based > 0 ? mainTrack1Based - 1 : null
}

// oud2の色 (00BBGGRR) → GTFSの route_color (RRGGBB)
function oudColorToGtfs(color) {
  if (!/^[0-9A-Fa-f]{8}$/.test(color || "")) return undefined
  const bb = color.slice(2, 4)
  const gg = color.slice(4, 6)
  const rr = color.slice(6, 8)
  const hex = `${rr}${gg}${bb}`.toUpperCase()
  return hex === "000000" ? undefined : hex
}

// ---------- 変換本体 ----------

function convert(root, options) {
  const rosen = root.children.find((c) => c.name === "Rosen")
  if (!rosen) throw new Error("Rosen ノードが見つかりません")

  const ekis = rosen.children.filter((c) => c.name === "Eki")
  const syubetsus = rosen.children.filter((c) => c.name === "Ressyasyubetsu")
  const dias = rosen.children.filter((c) => c.name === "Dia")

  // --- 駅 → stops（同名駅は同一駅として1つのstopに集約）---
  // 座標は架空路線のため合成値（メートル単位扱い）。駅間2000mで徒歩経路の誤提案を防ぐ。
  const stopIdByEkiIndex = []
  const stopsByName = new Map()
  const trackNamesByEkiIndex = []
  const downMainByEkiIndex = [] // 下り主本線（1始まり番線番号）
  const upMainByEkiIndex = [] // 上り主本線（1始まり番線番号）

  ekis.forEach((eki, i) => {
    const name = eki.props.Ekimei || `駅${i}`
    if (!stopsByName.has(name)) {
      stopsByName.set(name, {
        stop_id: name,
        stop_name: name,
        stop_lat: 1000,
        stop_lon: 2000 * (stopsByName.size + 1),
        location_type: 0,
        parent_station: "",
        stop_desc: STATION_READINGS[name] || "",
      })
    }
    stopIdByEkiIndex.push(name)

    const trackCont = eki.children.find((c) => c.name === "EkiTrack2Cont")
    const tracks = trackCont ? trackCont.children.filter((c) => c.name === "EkiTrack2") : []
    trackNamesByEkiIndex.push(tracks.map((t) => t.props.TrackRyakusyou || t.props.TrackName || ""))
    downMainByEkiIndex.push(Number.parseInt(eki.props.DownMain || "", 10) || null)
    upMainByEkiIndex.push(Number.parseInt(eki.props.UpMain || "", 10) || null)
  })

  const stops = Array.from(stopsByName.values())
  const stationCount = ekis.length

  // --- 種別 → routes ---
  const routes = syubetsus.map((s, i) => ({
    route_id: `KANNAN_${i}`,
    route_short_name: s.props.Ryakusyou || s.props.Syubetsumei || `種別${i}`,
    route_long_name: s.props.Syubetsumei || `種別${i}`,
    route_type: (s.props.Syubetsumei || "").includes("バス") ? 3 : 2,
    route_color: oudColorToGtfs(s.props.DiagramSenColor),
  }))
  const kaisouIndexes = new Set(
    syubetsus.map((s, i) => ((s.props.Syubetsumei || "") === "回送" ? i : -1)).filter((i) => i >= 0),
  )

  // --- カレンダー（路線内で曜日区別なしのため毎日運行の1サービス）---
  const calendar = [
    {
      service_id: "EVERYDAY",
      monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 1, sunday: 1,
      start_date: "20250101",
      end_date: "20991231",
    },
  ]

  // --- ダイヤ → datasets ---
  const datasets = []
  const usedRouteIds = new Set()

  for (const diaName of options.diaNames) {
    const diaIndex = dias.findIndex((d) => d.props.DiaName === diaName)
    if (diaIndex < 0) {
      throw new Error(`ダイヤ「${diaName}」が見つかりません。--list でダイヤ一覧を確認してください。`)
    }
    const dia = dias[diaIndex]
    const trips = []
    const stopTimes = []
    let skippedKaisou = 0
    let skippedEmpty = 0

    for (const direction of ["Kudari", "Nobori"]) {
      const dirNode = dia.children.find((c) => c.name === direction)
      if (!dirNode) continue
      const ressyas = dirNode.children.filter((c) => c.name === "Ressya")
      let seq = 0

      for (const ressya of ressyas) {
        const ekiJikoku = ressya.props.EkiJikoku
        if (!ekiJikoku) { skippedEmpty++; continue }

        const syubetsuIndex = Number.parseInt(ressya.props.Syubetsu || "0", 10) || 0
        if (!options.includeKaisou && kaisouIndexes.has(syubetsuIndex)) { skippedKaisou++; continue }

        const jikokuEntries = ekiJikoku.split(",")
        const trackEntries = (ressya.props.RessyaTrack || "").split(",")

        const rows = []
        for (let i = 0; i < jikokuEntries.length && i < stationCount; i++) {
          const jikoku = parseJikokuEntry(jikokuEntries[i])
          if (!jikoku) continue
          // 上り列車は終着駅側から逆順に格納されている
          const ekiIndex = direction === "Kudari" ? i : stationCount - 1 - i
          const trackValue = parseTrackValue(trackEntries[i])
          // V=0（主本線）の場合は方向に応じた主本線番号を使う
          const mainTrack = direction === "Kudari" ? downMainByEkiIndex[ekiIndex] : upMainByEkiIndex[ekiIndex]
          const trackIndex = resolveTrackIndex(trackValue, mainTrack)
          const platform =
            trackIndex !== null ? trackNamesByEkiIndex[ekiIndex]?.[trackIndex] || "" : ""
          rows.push({
            stop_id: stopIdByEkiIndex[ekiIndex],
            arrival_time: jikoku.arr,
            departure_time: jikoku.dep,
            platform_code: platform,
          })
        }

        if (rows.length < 2) { skippedEmpty++; continue }

        seq++
        const routeId = `KANNAN_${syubetsuIndex}`
        usedRouteIds.add(routeId)
        const tripId = `dia${diaIndex}_${direction === "Kudari" ? "down" : "up"}_${String(seq).padStart(3, "0")}`
        const lastStopName = rows[rows.length - 1].stop_id
        const operationNumber = ressya.props.OperationNumber

        trips.push({
          route_id: routeId,
          service_id: "EVERYDAY",
          trip_id: tripId,
          trip_headsign: `${lastStopName}行き`,
          trip_short_name: operationNumber ? `運用${operationNumber}` : ressya.props.Ressyabangou || "",
          direction_id: direction === "Kudari" ? 0 : 1,
        })

        rows.forEach((row, i) => {
          stopTimes.push({
            trip_id: tripId,
            arrival_time: row.arrival_time,
            departure_time: row.departure_time,
            stop_id: row.stop_id,
            stop_sequence: i + 1,
            platform_code: row.platform_code,
            drop_off_type: 0,
          })
        })
      }
    }

    datasets.push({
      id: `embedded-dia${diaIndex}`,
      name: diaName,
      uploadDate: new Date().toISOString(),
      stops,
      routes: routes.filter((r) => usedRouteIds.has(r.route_id)),
      trips,
      stopTimes,
      calendar,
      _stats: { skippedKaisou, skippedEmpty },
    })
  }

  // 全datasetで使われた種別routeを再設定（routesはdataset間で共通）
  const finalRoutes = routes.filter((r) => usedRouteIds.has(r.route_id))
  for (const ds of datasets) {
    ds.routes = finalRoutes
  }

  const activeDia = datasets.find((d) => d.name === options.active) || datasets[datasets.length - 1]
  return { datasets, activeDatasetId: activeDia.id }
}

// ---------- メイン ----------

const args = parseArgs(process.argv)
const sourcePath = path.resolve(args.source)
const text = readFileSync(sourcePath, "utf8")
const root = parseOud2(text)

if (args.list) {
  const rosen = root.children.find((c) => c.name === "Rosen")
  const dias = rosen.children.filter((c) => c.name === "Dia")
  console.log("ダイヤ一覧:")
  dias.forEach((d, i) => {
    const trains = d.children.flatMap((c) => c.children.filter((r) => r.name === "Ressya" && r.props.EkiJikoku))
    console.log(`  [${i}] ${d.props.DiaName} (${trains.length}本)`)
  })
  process.exit(0)
}

const { datasets, activeDatasetId } = convert(root, args)

const output = {
  generatedAt: new Date().toISOString(),
  source: path.basename(sourcePath),
  activeDatasetId,
  datasets: datasets.map(({ _stats, ...ds }) => ds),
}

const outputPath = path.resolve(args.output)
mkdirSync(path.dirname(outputPath), { recursive: true })
writeFileSync(outputPath, JSON.stringify(output, null, 1), "utf8")

console.log(`変換完了: ${outputPath}`)
for (const ds of datasets) {
  console.log(
    `  ${ds.name} (${ds.id}): 列車${ds.trips.length}本 / 時刻${ds.stopTimes.length}件 / 駅${ds.stops.length} / 種別${ds.routes.length}` +
      (ds._stats.skippedKaisou ? ` / 回送${ds._stats.skippedKaisou}本除外` : "") +
      (ds._stats.skippedEmpty ? ` / 空列車${ds._stats.skippedEmpty}本スキップ` : ""),
  )
}
console.log(`  アクティブ: ${activeDatasetId}`)
