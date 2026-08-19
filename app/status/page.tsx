import type { Metadata } from "next"
import { StatusView } from "./status-view"

export const metadata: Metadata = { title: "運行情報" }

// 運行情報ページ。掲載内容は管理画面「運行情報」の設定（status-settings）に従う。
export default function StatusPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-2xl space-y-6">
          <h1 className="text-2xl font-bold text-foreground">運行情報</h1>
          <StatusView />
        </div>
      </div>
    </main>
  )
}
