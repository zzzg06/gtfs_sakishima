import { adminAuthHeaders } from "./admin-session"
import type { SearchLogEntry, SearchLogTrip } from "@/app/api/search-log/route"

export type { SearchLogEntry, SearchLogTrip }

// 検索を記録（fire-and-forget、失敗しても検索体験に影響させない）
export function logSearch(entry: {
  from: string
  to: string
  mode: string
  time: string
  trips: SearchLogTrip[]
}): void {
  try {
    void fetch("/api/search-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "log", ...entry }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // 記録失敗は無視
  }
}

// 管理者: 検索履歴を取得
export async function loadSearchLog(): Promise<SearchLogEntry[]> {
  const res = await fetch("/api/search-log", { headers: { ...adminAuthHeaders() } })
  const result = await res.json().catch(() => null)
  if (!res.ok || !result?.success) {
    throw new Error(result?.error || "検索履歴の取得に失敗しました")
  }
  return result.entries as SearchLogEntry[]
}

// 管理者: 検索履歴をクリア
export async function clearSearchLog(): Promise<void> {
  const res = await fetch("/api/search-log", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({ action: "clear" }),
  })
  const result = await res.json().catch(() => null)
  if (!res.ok || !result?.success) {
    throw new Error(result?.error || "検索履歴のクリアに失敗しました")
  }
}
