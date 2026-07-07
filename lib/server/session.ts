import crypto from "crypto"

// 管理者認証とセッショントークン（サーバー専用）
//
// セッションはHMAC署名付きのステートレストークン。サーバー側に状態を持たないため、
// サーバーレス環境（Vercel等）でインスタンスが再起動・分散してもログインが維持される。

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000 // 24時間

export interface AdminCredentials {
  email: string
  password: string
  name: string
}

export function getAdminCredentials(): AdminCredentials {
  return {
    email: process.env.ADMIN_EMAIL || "admin@gtfs.local",
    password: process.env.ADMIN_PASSWORD || "admin123",
    name: process.env.ADMIN_NAME || "管理者",
  }
}

function getSecret(): Buffer {
  const fromEnv = process.env.SESSION_SECRET
  if (fromEnv) return Buffer.from(fromEnv, "utf8")
  // SESSION_SECRET未設定時は認証情報から導出（全インスタンスで同一になる）
  const { email, password } = getAdminCredentials()
  return crypto.createHash("sha256").update(`gtfs-session-secret:${email}:${password}`).digest()
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url")
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const ah = crypto.createHash("sha256").update(a).digest()
  const bh = crypto.createHash("sha256").update(b).digest()
  return crypto.timingSafeEqual(ah, bh)
}

export interface SessionPayload {
  email: string
  exp: number
}

export function createSessionToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + SESSION_DURATION_MS })).toString("base64url")
  return `${payload}.${sign(payload)}`
}

export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  if (!token) return null
  const dot = token.indexOf(".")
  if (dot < 0) return null
  const payload = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  const expected = sign(payload)
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload
    if (typeof data.email !== "string" || typeof data.exp !== "number") return null
    if (data.exp < Date.now()) return null
    return data
  } catch {
    return null
  }
}

// Authorizationヘッダー（Bearer）またはリクエストボディのsessionIdからセッションを検証
export function getRequestSession(request: Request, body?: { sessionId?: string }): SessionPayload | null {
  const header = request.headers.get("authorization")
  const bearer = header && header.toLowerCase().startsWith("bearer ") ? header.slice(7) : null
  return verifySessionToken(bearer || body?.sessionId)
}
