import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { buildResultUrl, decodeSearchToken } from "@/lib/search-query"

// 共有用の短縮URL /r/<トークン>。
// トークンを検索条件へ戻して、通常の結果ページ /result?... へ転送する。
// （リンクプレビュー用のタイトルはここで付ける。転送先の /result も同じタイトルを出す）

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  const parsed = decodeSearchToken(decodeURIComponent(token))
  if (!parsed) return { title: "経路検索" }
  const title = `${parsed.from}→${parsed.to}`
  const description = `${parsed.from}～${parsed.to}の乗換案内`
  return { title, description, openGraph: { title, description }, twitter: { title, description } }
}

export default async function ShortLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const parsed = decodeSearchToken(decodeURIComponent(token))
  // 壊れたトークンはトップへ
  if (!parsed) redirect("/")
  redirect(buildResultUrl(parsed.from, parsed.to, parsed.type, parsed.time, parsed.options))
}
