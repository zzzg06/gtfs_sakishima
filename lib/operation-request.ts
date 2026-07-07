import { adminAuthHeaders } from "./admin-session"
import type { OperationRequestEntry } from "@/app/api/operation-requests/route"

export type { OperationRequestEntry }

// 一般ユーザー: 運用リクエストを送信
export async function sendOperationRequest(req: {
  tripShortName: string
  routeName?: string
  headsign?: string
  message?: string
}): Promise<void> {
  const res = await fetch("/api/operation-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "request", ...req }),
  })
  const result = await res.json().catch(() => null)
  if (!res.ok || !result?.success) {
    throw new Error(result?.error || "リクエストの送信に失敗しました")
  }
}

// 管理者: 運用リクエスト一覧を取得（直近TTL分のみ）
export async function loadOperationRequests(): Promise<{ entries: OperationRequestEntry[]; ttlMinutes: number }> {
  const res = await fetch("/api/operation-requests", { headers: { ...adminAuthHeaders() } })
  const result = await res.json().catch(() => null)
  if (!res.ok || !result?.success) {
    throw new Error(result?.error || "リクエストの取得に失敗しました")
  }
  return { entries: result.entries as OperationRequestEntry[], ttlMinutes: result.ttlMinutes as number }
}

// 管理者: 運用リクエストをクリア
export async function clearOperationRequests(): Promise<void> {
  const res = await fetch("/api/operation-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({ action: "clear" }),
  })
  const result = await res.json().catch(() => null)
  if (!res.ok || !result?.success) {
    throw new Error(result?.error || "リクエストのクリアに失敗しました")
  }
}
