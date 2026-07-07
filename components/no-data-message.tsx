"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Database, AlertCircle, Settings } from "lucide-react"

interface NoDataMessageProps {
  onShowAdminPanel?: () => void
  showAdminButton?: boolean
}

export function NoDataMessage({ onShowAdminPanel, showAdminButton = false }: NoDataMessageProps) {
  return (
    <div className="space-y-6">
      <Card className="text-center">
        <CardHeader>
          <div className="mx-auto w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-4">
            <Database className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle className="text-xl">データが見つかりません</CardTitle>
          <CardDescription className="text-base">
            現在、検索可能なGTFSデータがアップロードされていません。
            <br />
            経路検索を利用するには、管理者によるデータのアップロードが必要です。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="text-left text-sm text-blue-800">
                <p className="font-medium mb-1">GTFSデータについて</p>
                <p>
                  GTFS（General Transit Feed Specification）は、公共交通機関の
                  スケジュールデータを標準化した形式です。このシステムでは、
                  stops.csv、routes.csv、trips.csv、stop_times.csv、calendar.csv の各ファイルが必要です。
                </p>
              </div>
            </div>
          </div>

          {showAdminButton && onShowAdminPanel && (
            <div className="pt-2">
              <Button onClick={onShowAdminPanel} className="gap-2">
                <Settings className="h-4 w-4" />
                管理者としてデータを管理
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                管理者の方は上記ボタンからGTFSデータをアップロードできます
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
