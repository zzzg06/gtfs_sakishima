// 徒歩リスト(.xlsx) → data/embedded-walk.json 変換スクリプト
//
// 使い方:
//   node scripts/convert-walk.mjs
//   node scripts/convert-walk.mjs --source data/徒歩リスト.xlsx
//
// 列: WalkID, SpotA, SpotB, Time(分), Memo
// WalkID先頭が Y = 連続して徒歩可、W = 連続不可（単独でのみ徒歩可）

import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const XLSX = require("xlsx")

const args = { source: "data/徒歩リスト.xlsx", output: "data/embedded-walk.json", sheet: "Walk_List" }
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--source") args.source = process.argv[++i]
  else if (process.argv[i] === "--output") args.output = process.argv[++i]
  else if (process.argv[i] === "--sheet") args.sheet = process.argv[++i]
}

const wb = XLSX.readFile(path.resolve(args.source))
const sheetName = wb.SheetNames.includes(args.sheet) ? args.sheet : wb.SheetNames[0]
const ws = wb.Sheets[sheetName]
// ヘッダー行が壊れている可能性があるため列位置で読む（A:WalkID B:SpotA C:SpotB D:Time E:Memo）
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false })

const segments = []
const skipped = []
for (let i = 1; i < rows.length; i++) {
  const r = rows[i]
  if (!r || r.length === 0) continue
  const id = String(r[0] ?? "").trim()
  const a = String(r[1] ?? "").trim()
  const b = String(r[2] ?? "").trim()
  const time = Number.parseFloat(r[3])
  if (!id || !a || !b) continue
  if (!/^[WY]/i.test(id)) {
    skipped.push(`${id}（WalkIDがW/Y始まりでない）`)
    continue
  }
  if (Number.isNaN(time) || time < 0) {
    skipped.push(`${id}（時間が数値でない: ${r[3]}）`)
    continue
  }
  segments.push({
    id,
    a,
    b,
    time, // 分
    consecutive: /^Y/i.test(id), // Y=連続徒歩可
  })
}

const output = {
  generatedAt: new Date().toISOString(),
  source: path.basename(args.source),
  segments,
}

const outPath = path.resolve(args.output)
mkdirSync(path.dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(output, null, 1), "utf8")

const yCount = segments.filter((s) => s.consecutive).length
console.log(`変換完了: ${outPath}`)
console.log(`  徒歩区間 ${segments.length}件（連続可Y:${yCount} / 連続不可W:${segments.length - yCount}）`)
if (skipped.length) console.log(`  スキップ ${skipped.length}件: ${skipped.join(", ")}`)

// 駅間（バス停を含まない）の区間を参考表示
const stationSegs = segments.filter((s) => !s.a.startsWith("(バス)") && !s.b.startsWith("(バス)"))
console.log(`  うち駅⇔駅の区間: ${stationSegs.length}件`)
stationSegs.forEach((s) => console.log(`    ${s.id} ${s.a}⇔${s.b} ${s.time}分 (${s.consecutive ? "連続可" : "単独"})`))
