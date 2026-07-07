"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { AdminDataManager } from "@/components/admin-data-manager"
import { AdminLogin } from "@/components/admin-login"
import { AdminHeader } from "@/components/admin-header"
import { DataStorageInfo } from "@/components/data-storage-info"
import { useAuth } from "@/lib/auth"
import { GTFSStorage } from "@/lib/gtfs-storage"
import { gtfsParser } from "@/lib/gtfs-parser"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

export default function AdminPage() {
  const [dataLoaded, setDataLoaded] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(true)
  const { admin, isLoading: authLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        console.log("[v0] 管理者ページ: GTFSデータを確認中...")
        const hasServerData = await GTFSStorage.hasData()

        if (hasServerData) {
          console.log("[v0] 管理者ページ: GTFSデータが存在します。読み込み中...")
          const activeDataset = await GTFSStorage.getActiveDataset()

          if (activeDataset) {
            await gtfsParser.loadFromStorageAsync()
            setDataLoaded(true)
            console.log("[v0] 管理者ページ: GTFSデータの読み込みが完了しました")
          } else {
            console.log("[v0] 管理者ページ: アクティブなデータセットが見つかりません")
            setDataLoaded(false)
          }
        } else {
          console.log("[v0] 管理者ページ: GTFSデータが存在しません")
          setDataLoaded(false)
        }
      } catch (error) {
        console.error("[v0] 管理者ページ: データ読み込みエラー:", error)
        setDataLoaded(false)
      } finally {
        setIsLoadingData(false)
      }
    }

    loadInitialData()
  }, [])

  const handleDataLoaded = () => {
    setDataLoaded(true)
  }

  const handleBackToHome = () => {
    router.push("/")
  }

  // 認証チェック中
  if (authLoading) {
    return (
      <main className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-foreground mb-4">管理者ページ</h1>
            <p className="text-lg text-muted-foreground">認証状態を確認中...</p>
          </div>
        </div>
      </main>
    )
  }

  // 未認証の場合はログイン画面を表示
  if (!admin) {
    return (
      <main className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-6">
            <Button variant="outline" onClick={handleBackToHome} className="flex items-center gap-2 bg-transparent">
              <ArrowLeft className="h-4 w-4" />
              一般ユーザー画面に戻る
            </Button>
          </div>
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-3">管理者ページ</h1>
            <p className="text-muted-foreground">管理者としてログインしてください</p>
          </div>
          <AdminLogin />
        </div>
      </main>
    )
  }

  // データ読み込み中
  if (isLoadingData) {
    return (
      <main className="min-h-screen bg-background">
        <AdminHeader />
        <div className="container mx-auto px-4 py-8">
          <p className="py-12 text-center text-muted-foreground">データを読み込み中...</p>
        </div>
      </main>
    )
  }

  // 管理者ページのメインコンテンツ（戻る/ログアウトは AdminHeader に集約）
  return (
    <main className="min-h-screen bg-background">
      <AdminHeader />
      <div className="container mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            GTFSデータ・運用・車両・経路設定などを管理できます。
          </p>
          <p className="text-sm text-muted-foreground">
            データ状態: {dataLoaded ? "読み込み済み" : "未読み込み"}
          </p>
        </div>

        <div className="space-y-6">
          <DataStorageInfo />

          <AdminDataManager onDataLoaded={handleDataLoaded} />
        </div>
      </div>
    </main>
  )
}
