"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Search, Clock, Info, Train, Settings, CircleHelp } from "lucide-react"

// PC表示（lg以上）でのみ表示する左サイドのメニューバー。モバイルでは非表示。
const NAV_ITEMS = [
  { href: "/", label: "検索", icon: Search, isActive: (p: string) => p === "/" || p.startsWith("/result") },
  { href: "/timetable", label: "時刻表", icon: Clock, isActive: (p: string) => p.startsWith("/timetable") },
  { href: "/status", label: "運行情報", icon: Info, isActive: (p: string) => p.startsWith("/status") },
  { href: "/live", label: "列車走行位置", icon: Train, isActive: (p: string) => p.startsWith("/live") },
  { href: "/help", label: "使い方", icon: CircleHelp, isActive: (p: string) => p.startsWith("/help") },
]

export function SideNav() {
  const pathname = usePathname()
  // 管理画面ではサイドメニューを出さない（独自のヘッダーがあるため）
  if (pathname.startsWith("/admin")) return null

  return (
    <nav className="hidden w-56 shrink-0 flex-col self-start border-r border-border bg-card lg:sticky lg:top-0 lg:flex lg:h-screen">
      <div className="border-b border-border px-4 py-5">
        <Link href="/" className="text-lg font-bold text-green-700">
          関南乗換案内
        </Link>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => {
          const active = item.isActive(pathname)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active ? "bg-green-700 text-white" : "text-foreground hover:bg-accent"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          )
        })}
      </div>

      <div className="border-t border-border p-3">
        <Link
          href="/admin"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
        >
          <Settings className="h-4 w-4 shrink-0" />
          管理者ログイン
        </Link>
      </div>
    </nav>
  )
}
