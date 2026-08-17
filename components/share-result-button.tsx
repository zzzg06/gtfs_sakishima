"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Check, Copy, Share2 } from "lucide-react"

// 検索結果の共有ボタン。押すと現在の検索条件(URL)から共有リンクを作り、
// コピー用のダイアログを出す（対応端末では端末の共有シートも使える）。
// 結果そのもののスナップショットではなく「同じ条件で再検索されるリンク」である点は
// 誤解を招かないようダイアログに明記する。
export function ShareResultButton({
  path,
  title,
  className,
}: {
  path: string // 例: /result?from=..&to=..&type=dep&time=0830
  title?: string // 共有シートに出す見出し（例: 咲島港→中原台）
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const createLink = () => {
    setUrl(`${window.location.origin}${path}`)
    setCopied(false)
    setCopyError(false)
    setOpen(true)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setCopyError(false)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // クリップボードが使えない環境（http・権限拒否など）では手動コピーしてもらう
      setCopyError(true)
      inputRef.current?.select()
    }
  }

  // 端末の共有シート（対応ブラウザのみ）。未対応ならボタン自体を出さない。
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function"
  const nativeShare = async () => {
    try {
      await navigator.share({ title: title || "乗換案内", url })
      setOpen(false)
    } catch {
      // 共有のキャンセルは無視（ダイアログは開いたまま）
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={createLink} className={className}>
        <Share2 className="mr-1 h-3.5 w-3.5" />
        共有
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>検索結果を共有</DialogTitle>
            <DialogDescription>
              このリンクを開くと、同じ検索条件（出発地・到着地・時刻・交通手段）で検索し直した結果が表示されます。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
              aria-label="共有リンク"
            />
            <Button type="button" onClick={copy} className="shrink-0">
              {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
              {copied ? "コピー済" : "コピー"}
            </Button>
          </div>
          {copyError && (
            <p className="text-xs text-destructive">
              自動コピーできませんでした。上のリンクを選択してコピーしてください。
            </p>
          )}
          <DialogFooter className="sm:justify-start">
            {canNativeShare && (
              <Button type="button" variant="outline" onClick={nativeShare}>
                <Share2 className="mr-1 h-4 w-4" />
                他のアプリで共有
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
