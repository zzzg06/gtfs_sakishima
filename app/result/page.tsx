import type { Metadata } from "next"
import { Suspense } from "react"
import { RefreshCw } from "lucide-react"
import { ResultView } from "./result-view"

// サーバー側で動的タイトルを付与（履歴・共有・Discord等のリンクプレビューに反映）。
// 検索条件はURLに載っているので gtfsParser 無しでも「出発→到着」を作れる。
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<Metadata> {
  const sp = await searchParams
  const from = typeof sp.from === "string" ? sp.from : ""
  const to = typeof sp.to === "string" ? sp.to : ""
  if (from && to) {
    // layout の title.template により「… | 関南乗換案内」になる
    const title = `${from}→${to}`
    const description = `${from}～${to}の乗換案内`
    return {
      title,
      description,
      openGraph: { title, description },
      twitter: { title, description },
    }
  }
  return { title: "経路検索" }
}

export default function ResultPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <Suspense
          fallback={
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin" />
              読み込み中...
            </div>
          }
        >
          <ResultView />
        </Suspense>
      </div>
    </main>
  )
}
