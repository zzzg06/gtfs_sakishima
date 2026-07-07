import { type NextRequest, NextResponse } from "next/server"
import { readJsonFile, writeJsonFile } from "@/lib/server/file-store"
import { getRequestSession } from "@/lib/server/session"

// 検索履歴API
//
// 記録(action:"log")は一般ユーザーの検索ごとに呼ばれるため認証不要。
// 閲覧(GET)とクリア(action:"clear")は管理者認証必須。
// data/runtime/search-log.json に直近MAX_ENTRIES件を保存。

export interface SearchLogTrip {
  routeName?: string
  tripShortName?: string
  headsign?: string
}

export interface SearchLogEntry {
  ts: string // ISO日時
  from: string
  to: string
  mode: string // departure | arrival | none
  time: string
  trips: SearchLogTrip[]
}

const FILE = "search-log.json"
const MAX_ENTRIES = 1000

let memory: SearchLogEntry[] | null = null

async function load(): Promise<SearchLogEntry[]> {
  if (!memory) {
    memory = (await readJsonFile<SearchLogEntry[]>(FILE)) || []
  }
  return memory
}

async function save(entries: SearchLogEntry[]): Promise<void> {
  memory = entries
  await writeJsonFile(FILE, entries)
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

    if (action === "log") {
      const { from, to, mode, time, trips } = body
      if (typeof from !== "string" || typeof to !== "string") {
        return NextResponse.json({ success: false, error: "Invalid entry" }, { status: 400 })
      }
      const entry: SearchLogEntry = {
        ts: new Date().toISOString(),
        from: from.slice(0, 100),
        to: to.slice(0, 100),
        mode: typeof mode === "string" ? mode : "",
        time: typeof time === "string" ? time : "",
        trips: Array.isArray(trips)
          ? trips.slice(0, 20).map((t: SearchLogTrip) => ({
              routeName: typeof t?.routeName === "string" ? t.routeName.slice(0, 50) : undefined,
              tripShortName: typeof t?.tripShortName === "string" ? t.tripShortName.slice(0, 50) : undefined,
              headsign: typeof t?.headsign === "string" ? t.headsign.slice(0, 50) : undefined,
            }))
          : [],
      }

      const entries = await load()
      entries.push(entry)
      // 直近MAX_ENTRIES件のみ保持
      const trimmed = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries
      await save(trimmed)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("[gtfs] Search log POST error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  if (!getRequestSession(request)) {
    return NextResponse.json({ success: false, error: "管理者認証が必要です" }, { status: 401 })
  }
  const entries = await load()
  // 新しい順で返す
  return NextResponse.json({ success: true, entries: [...entries].reverse() })
}
