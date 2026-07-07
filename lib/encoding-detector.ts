// 文字エンコーディング検出とCSVファイル検証のユーティリティ

export interface CSVValidationResult {
  isValid: boolean
  encoding: string
  errors: string[]
  rowCount: number
  columns: string[]
}

// 文字エンコーディングを検出する関数
export async function detectEncoding(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const uint8Array = new Uint8Array(buffer)

  // UTF-8 BOMをチェック
  if (uint8Array.length >= 3 && uint8Array[0] === 0xef && uint8Array[1] === 0xbb && uint8Array[2] === 0xbf) {
    return "UTF-8"
  }

  // 厳密モードでUTF-8としてデコードできればUTF-8、できなければShift_JISと判定
  // （正しいUTF-8バイト列がShift_JISと衝突することはほぼないため確実に判別できる）
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(uint8Array)
    return "UTF-8"
  } catch {
    return "Shift_JIS"
  }
}

// ファイルを適切なエンコーディングで読み込む
export async function readFileWithEncoding(file: File): Promise<string> {
  const encoding = await detectEncoding(file)

  if (encoding === "Shift_JIS") {
    const buffer = await file.arrayBuffer()
    const decoder = new TextDecoder("shift_jis")
    return decoder.decode(buffer)
  } else {
    return await file.text()
  }
}

// CSVファイルの形式を検証する
export function validateCSVFormat(content: string, expectedColumns: string[]): CSVValidationResult {
  const errors: string[] = []

  console.log("[v0] validateCSVFormat called with expectedColumns:", expectedColumns)

  if (!expectedColumns || !Array.isArray(expectedColumns)) {
    console.log("[v0] expectedColumns is undefined or not an array")
    return {
      isValid: false,
      encoding: "unknown",
      errors: ["必須カラムの定義が見つかりません"],
      rowCount: 0,
      columns: [],
    }
  }

  if (!content.trim()) {
    return {
      isValid: false,
      encoding: "unknown",
      errors: ["ファイルが空です"],
      rowCount: 0,
      columns: [],
    }
  }

  const lines = content.trim().split("\n")
  if (lines.length < 2) {
    errors.push("ヘッダー行とデータ行が必要です")
  }

  // ヘッダー行をチェック
  const headerLine = lines[0]
  const columns = headerLine.split(",").map((col) => col.trim().replace(/"/g, ""))

  console.log("[v0] CSV columns found:", columns)

  // 必須カラムの存在チェック
  const missingColumns = expectedColumns.filter((col) => !columns.includes(col))
  if (missingColumns.length > 0) {
    errors.push(`必須カラムが不足しています: ${missingColumns.join(", ")}`)
  }

  // データ行の形式チェック
  const dataLines = lines.slice(1)
  const columnCount = columns.length

  for (let i = 0; i < Math.min(dataLines.length, 10); i++) {
    const line = dataLines[i]
    if (line.trim()) {
      const cells = line.split(",")
      if (cells.length !== columnCount) {
        errors.push(`${i + 2}行目: カラム数が一致しません (期待値: ${columnCount}, 実際: ${cells.length})`)
      }
    }
  }

  return {
    isValid: errors.length === 0,
    encoding: "detected",
    errors,
    rowCount: dataLines.filter((line) => line.trim()).length,
    columns,
  }
}

// GTFS各ファイルの必須カラム定義
export const GTFS_REQUIRED_COLUMNS = {
  stops: ["stop_id", "stop_name"],
  routes: ["route_id", "route_short_name", "route_long_name", "route_type"],
  trips: ["route_id", "service_id", "trip_id"],
  stopTimes: ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
  calendar: [
    "service_id",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "start_date",
    "end_date",
  ],
}
