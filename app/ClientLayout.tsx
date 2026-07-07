"use client"

import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Analytics } from "@vercel/analytics/next"
import { ThemeProvider } from "next-themes"
import { Toaster } from "react-hot-toast"
import { Suspense } from "react"
import type React from "react"
import { AuthProvider } from "@/lib/auth"
import { SideNav } from "@/components/side-nav"

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja" className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AuthProvider>
            <Suspense fallback={null}>
              {/* PCのみ左サイドメニュー。モバイルはSideNav側でhidden。 */}
              <div className="lg:flex lg:items-start">
                <SideNav />
                <div className="min-w-0 flex-1">{children}</div>
              </div>
              <Toaster />
            </Suspense>
          </AuthProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
