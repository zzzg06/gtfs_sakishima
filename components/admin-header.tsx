"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { ArrowLeft } from "lucide-react"

export function AdminHeader() {
  const { admin, logout } = useAuth()

  if (!admin) return null

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">
            関南乗換案内 <span className="text-muted-foreground">管理画面</span>
          </h1>
          <p className="truncate text-sm text-muted-foreground">
            ログイン中: {admin.name} ({admin.email})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" />
              一般画面へ
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={logout}>
            ログアウト
          </Button>
        </div>
      </div>
    </header>
  )
}
