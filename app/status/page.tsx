import type { Metadata } from "next"
import { Info } from "lucide-react"

export const metadata: Metadata = { title: "運行情報" }

// 運行情報ページ。現時点では掲載する情報がないためプレースホルダのみ。
export default function StatusPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-2xl space-y-6">
          <h1 className="text-2xl font-bold text-foreground">運行情報</h1>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card py-16 text-center">
            <Info className="h-8 w-8 text-muted-foreground" />
            <p className="text-muted-foreground">現在、お知らせする運行情報はありません。</p>
          </div>
        </div>
      </div>
    </main>
  )
}
