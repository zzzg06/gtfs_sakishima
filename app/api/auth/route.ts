import { type NextRequest, NextResponse } from "next/server"
import {
  createSessionToken,
  getAdminCredentials,
  getRequestSession,
  timingSafeStringEqual,
  verifySessionToken,
} from "@/lib/server/session"

// 管理者認証API
//
// セッションはHMAC署名付きステートレストークン（lib/server/session.ts）。
// 認証情報は環境変数 ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME で設定する
// （未設定時は開発用デフォルト admin@gtfs.local / admin123）。

function adminInfo() {
  const { email, name } = getAdminCredentials()
  return { id: "1", email, name }
}

export async function POST(request: NextRequest) {
  try {
    const { action, email, password, sessionId } = await request.json()

    switch (action) {
      case "login": {
        const credentials = getAdminCredentials()
        const emailOk = typeof email === "string" && timingSafeStringEqual(email, credentials.email)
        const passwordOk = typeof password === "string" && timingSafeStringEqual(password, credentials.password)

        if (emailOk && passwordOk) {
          return NextResponse.json({
            success: true,
            admin: adminInfo(),
            sessionId: createSessionToken(credentials.email),
          })
        }

        return NextResponse.json({ success: false, error: "Invalid credentials" }, { status: 401 })
      }

      case "verify": {
        const session = verifySessionToken(sessionId)
        if (session) {
          return NextResponse.json({ success: true, admin: adminInfo() })
        }
        return NextResponse.json({ success: false, error: "Invalid or expired session" }, { status: 401 })
      }

      case "logout":
        // ステートレストークンのためサーバー側の破棄処理は不要（クライアントが破棄する）
        return NextResponse.json({ success: true })

      default:
        return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 })
    }
  } catch (error) {
    console.error("Auth API error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId")
  const session = verifySessionToken(sessionId) || getRequestSession(request)

  if (session) {
    return NextResponse.json({ success: true, admin: adminInfo() })
  }

  return NextResponse.json({ success: false, error: "Invalid or expired session" }, { status: 401 })
}
