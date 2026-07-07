"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Database, Server, Info, ChevronDown, ChevronRight, CheckCircle, Package, Globe } from "lucide-react"

export function DataStorageInfo() {
  const [isExpanded, setIsExpanded] = useState(false)

  const storageTypes = [
    {
      name: "同梱ダイヤデータ",
      icon: Package,
      description: "OuDiaSecondから変換したGTFSデータ（路線、駅、運用、時刻表）。アプリ本体に同梱",
      apiEndpoint: "/api/gtfs",
      location: "data/embedded-gtfs.json（ビルドに同梱・常に利用可能）",
    },
    {
      name: "アップロードGTFSデータ",
      icon: Server,
      description: "管理画面からアップロードしたGTFSデータセット",
      apiEndpoint: "/api/gtfs",
      location: "サーバー data/runtime/gtfs-datasets.json",
    },
    {
      name: "車両情報",
      icon: Server,
      description: "車両データと運用-車両関連付け",
      apiEndpoint: "/api/shared-data",
      location: "サーバー data/runtime/shared-data.json",
    },
    {
      name: "遅延・運行状況",
      icon: Server,
      description: "運用の遅延時間、運行状況、理由",
      apiEndpoint: "/api/shared-data",
      location: "サーバー data/runtime/shared-data.json",
    },
    {
      name: "運用表示設定",
      icon: Server,
      description: "各運用の検索結果表示/非表示設定",
      apiEndpoint: "/api/shared-data",
      location: "サーバー data/runtime/shared-data.json",
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          データ保存場所について
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            すべてのデータは<strong>サーバーサイド</strong>で管理されます。 ダイヤデータはアプリ本体に同梱されているため、
            サーバーが再起動してもデータが失われることはありません。
          </AlertDescription>
        </Alert>

        <div className="grid gap-4">
          <Card className="border-blue-200 bg-blue-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Server className="h-4 w-4 text-blue-600" />
                サーバーサイド保存
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm">全ユーザー・全端末で同じデータを共有</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm">ダイヤデータはアプリに同梱（消失しない）</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm">更新には管理者ログインが必要</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                サーバーレス環境（Vercel等）では運行情報・アップロードは揮発します。恒久的なダイヤ変更は
                .oud2を編集して同梱データを再生成してください。
              </p>
            </CardContent>
          </Card>

          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full justify-between bg-transparent">
                <span>詳細なデータ保存情報</span>
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 mt-4">
              <div className="grid gap-3">
                {storageTypes.map((storage, index) => (
                  <Card key={index} className="border-gray-200">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{storage.name}</CardTitle>
                        <Badge variant="default" className="text-xs bg-blue-600">
                          <storage.icon className="h-3 w-3 mr-1" />
                          サーバー
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-2">
                      <p className="text-xs text-muted-foreground">{storage.description}</p>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Globe className="h-3 w-3 text-blue-600" />
                          <span className="text-xs font-mono">{storage.apiEndpoint}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Server className="h-3 w-3 text-blue-600" />
                          <span className="text-xs font-mono">{storage.location}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Alert className="border-blue-200 bg-blue-50">
                <Info className="h-4 w-4" />
                <AlertDescription>
                  <strong>ダイヤデータの更新手順：</strong>
                  <br />
                  1. OuDiaSecondで .oud2 ファイルを編集
                  <br />
                  2. <span className="font-mono text-xs">npm run convert:gtfs</span> で同梱データを再生成
                  <br />
                  3. 変更をコミットしてデプロイ
                </AlertDescription>
              </Alert>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </CardContent>
    </Card>
  )
}
