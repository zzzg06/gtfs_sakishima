import { type NextRequest, NextResponse } from "next/server"
import { readJsonFile, writeJsonFile } from "@/lib/server/file-store"
import { getRequestSession } from "@/lib/server/session"

// 運用リクエストAPI
//
// 送信(action:"request")は検索結果から一般ユーザーが運用をタップして送るため認証不要。
// 閲覧(GET)とクリア(action:"clear")は管理者認証必須。
// data/runtime/operation-requests.json に保存し、直近 TTL 分のみ有効（ローリングで自動リセット）。

export interface OperationRequestEntry {
  ts: string // ISO日時
  tripShortName: string // 運用番号
  routeName?: string
  headsign?: string
  message?: string // 任意のひとこと
}

const FILE = "operation-requests.json"
const TTL_MINUTES = 30 // 数十分でリセット（この時間より古いリクエストは破棄）
const MAX_ENTRIES = 500

let memory: OperationRequestEntry[] | null = null

async function load(): Promise<OperationRequestEntry[]> {
  if (!memory) {
    memory = (await readJsonFile<OperationRequestEntry[]>(FILE)) || []
  }
  return memory
}

async function save(entries: OperationRequestEntry[]): Promise<void> {
  memory = entries
  await writeJsonFile(FILE, entries)
}

// TTLより古いものを除外（ローリングなリセット）
function prune(entries: OperationRequestEntry[]): OperationRequestEntry[] {
  const cutoff = Date.now() - TTL_MINUTES * 60 * 1000
  return entries.filter((e) => {
    const t = new Date(e.ts).getTime()
    return Number.isFinite(t) && t >= cutoff
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body

    if (action === "clear") {
      if (!getRequestSession(request, body)) {
        return NextResponse.json({ success: false, error: "管理者認証が必要です" }, { status: 401 })
      }
      await save([])
      return NextResponse.json({ success: true })
    }

    if (action === "request") {
      const { tripShortName, routeName, headsign, message } = body
      if (typeof tripShortName !== "string" || tripShortName.trim().length === 0) {
        return NextResponse.json({ success: false, error: "運用が指定されていません" }, { status: 400 })
      }
      const entry: OperationRequestEntry = {
        ts: new Date().toISOString(),
        tripShortName: tripShortName.slice(0, 50),
        routeName: typeof routeName === "string" ? routeName.slice(0, 50) : undefined,
        headsign: typeof headsign === "string" ? headsign.slice(0, 50) : undefined,
        message: typeof message === "string" && message.trim() ? message.slice(0, 200) : undefined,
      }

      const entries = prune(await load())
      entries.push(entry)
      const trimmed = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries
      await save(trimmed)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("[gtfs] Operation request POST error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  if (!getRequestSession(request)) {
    return NextResponse.json({ success: false, error: "管理者認証が必要です" }, { status: 401 })
  }
  const entries = prune(await load())
  // 期限切れを掃除した結果を保存し直す（ファイルも肥大化させない）
  await save(entries)
  // 新しい順で返す
  return NextResponse.json({ success: true, entries: [...entries].reverse(), ttlMinutes: TTL_MINUTES })
}
