// 管理者セッションのクライアント側ヘルパー

export const ADMIN_SESSION_STORAGE_KEY = "gtfs-admin-session"

export function getAdminSessionId(): string | null {
  if (typeof window === "undefined") return null
  try {
    return localStorage.getItem(ADMIN_SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

// 更新系APIに付与する認証ヘッダー
export function adminAuthHeaders(): Record<string, string> {
  const sessionId = getAdminSessionId()
  return sessionId ? { Authorization: `Bearer ${sessionId}` } : {}
}
