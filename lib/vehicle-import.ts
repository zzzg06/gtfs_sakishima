import type { Vehicle } from "./vehicle-manager"
import { readFileWithEncoding } from "./encoding-detector"

// 車両データのExcel(.xlsx)/CSV一括インポート
//
// 1行目をヘッダーとして読み取る。認識するカラム（日本語/英語どちらでも可）:
//   車両名(必須) / 車両タイプ(必須) / 定員 / 説明 / 表示色(#RRGGBB)

export interface VehicleImportResult {
  vehicles: Omit<Vehicle, "id">[]
  errors: string[]
}

type VehicleField = "name" | "type" | "capacity" | "description" | "color" | "iconUrl"

const HEADER_ALIASES: Record<string, VehicleField> = {
  車両名: "name",
  名前: "name",
  name: "name",
  車両タイプ: "type",
  タイプ: "type",
  種別: "type",
  type: "type",
  定員: "capacity",
  capacity: "capacity",
  説明: "description",
  備考: "description",
  description: "description",
  表示色: "color",
  色: "color",
  color: "color",
  アイコンurl: "iconUrl",
  iconurl: "iconUrl",
  icon_url: "iconUrl",
}

function normalizeHeader(header: string): VehicleField | null {
  return HEADER_ALIASES[header.trim().toLowerCase()] ?? HEADER_ALIASES[header.trim()] ?? null
}

function normalizeColor(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`
  return undefined
}

export async function parseVehicleFile(file: File): Promise<VehicleImportResult> {
  const XLSX = await import("xlsx")

  let workbook: import("xlsx").WorkBook
  if (file.name.toLowerCase().endsWith(".csv")) {
    // 日本語Excelが出力するShift_JIS CSVに対応
    const text = await readFileWithEncoding(file)
    workbook = XLSX.read(text, { type: "string" })
  } else {
    const buffer = await file.arrayBuffer()
    workbook = XLSX.read(buffer, { type: "array" })
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) {
    return { vehicles: [], errors: ["シートが見つかりません"] }
  }

  // ヘッダー行を取得してフィールドに対応付け
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })
  if (rows.length === 0) {
    return { vehicles: [], errors: ["データ行がありません（1行目はヘッダーとして扱われます）"] }
  }

  const headerMap = new Map<string, VehicleField>()
  for (const key of Object.keys(rows[0])) {
    const field = normalizeHeader(key)
    if (field) headerMap.set(key, field)
  }

  if (![...headerMap.values()].includes("name") || ![...headerMap.values()].includes("type")) {
    return {
      vehicles: [],
      errors: ["ヘッダーに「車両名」と「車両タイプ」の列が必要です（テンプレートを参照してください）"],
    }
  }

  const vehicles: Omit<Vehicle, "id">[] = []
  const errors: string[] = []

  rows.forEach((row, index) => {
    const rowNumber = index + 2 // ヘッダーが1行目

    const record: Partial<Record<VehicleField, string>> = {}
    for (const [key, field] of headerMap) {
      record[field] = String(row[key] ?? "").trim()
    }

    // 完全な空行はスキップ
    if (Object.values(record).every((v) => !v)) return

    if (!record.name) {
      errors.push(`${rowNumber}行目: 車両名が空のためスキップしました`)
      return
    }
    if (!record.type) {
      errors.push(`${rowNumber}行目: 車両タイプが空のためスキップしました`)
      return
    }

    let capacity: number | undefined
    if (record.capacity) {
      const parsed = Number.parseInt(record.capacity, 10)
      if (Number.isNaN(parsed) || parsed < 0) {
        errors.push(`${rowNumber}行目: 定員「${record.capacity}」が数値でないため定員なしで取り込みました`)
      } else {
        capacity = parsed
      }
    }

    const color = record.color ? normalizeColor(record.color) : undefined
    if (record.color && !color) {
      errors.push(`${rowNumber}行目: 表示色「${record.color}」が#RRGGBB形式でないため既定色で取り込みました`)
    }

    vehicles.push({
      name: record.name,
      type: record.type,
      capacity,
      description: record.description || undefined,
      color: color || "#3b82f6",
      iconUrl: record.iconUrl || undefined,
    })
  })

  return { vehicles, errors }
}

// 取込用テンプレート(.xlsx)をダウンロード
export async function downloadVehicleTemplate(): Promise<void> {
  const XLSX = await import("xlsx")

  const sheet = XLSX.utils.aoa_to_sheet([
    ["車両名", "車両タイプ", "定員", "説明", "表示色"],
    ["1001号車", "電車", 150, "新型車両", "#3b82f6"],
    ["2001号車", "バス", 45, "", "#ef4444"],
  ])
  sheet["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 24 }, { wch: 10 }]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, "車両")
  XLSX.writeFile(workbook, "車両インポートテンプレート.xlsx")
}
