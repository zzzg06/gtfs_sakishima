import type React from "react"
import type { Metadata } from "next"
import "./globals.css"
import ClientLayout from "./ClientLayout"

const SITE_NAME = "関南乗換案内"
const SITE_DESC = "咲島の鉄道・バスをまとめて検索できる乗換案内。咲島祭でもご利用いただけます。"
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined)

export const metadata: Metadata = {
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  // 各ページはタイトルの前半だけ指定すれば「… | 関南乗換案内」になる
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESC,
  applicationName: SITE_NAME,
  generator: "v0.app",
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESC,
    siteName: SITE_NAME,
    type: "website",
    locale: "ja_JP",
  },
  twitter: {
    card: "summary",
    title: SITE_NAME,
    description: SITE_DESC,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <ClientLayout>{children}</ClientLayout>
}
