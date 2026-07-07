"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import { TrainLocationBoard } from "@/components/train-location-board"

// 列車走行位置（在線表示）ページ。/live で閲覧。
export default function LivePage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">列車走行位置</h1>
          {/* PCはサイドメニューで移動できるため戻るボタンはモバイルのみ */}
          <Link href="/" className="lg:hidden">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" />
              乗換案内に戻る
            </Button>
          </Link>
        </div>
        <TrainLocationBoard />
      </div>
    </main>
  )
}
