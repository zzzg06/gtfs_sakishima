"use client"

import { vehicleManager } from "@/lib/vehicle-manager"
import { vehicleForDynmapIcon, vehicleNameForDynmapIcon } from "@/lib/dynmap-vehicle-icons"
import { abbrevSyubetsu, delayInfo, formatHeadsign } from "@/lib/train-display"
import type { TrainRunState } from "@/lib/train-position"
import { X } from "lucide-react"

// 運用詳細（列車アイコンをクリックしたときのモーダル）。
// /live の走行位置と管理画面の運行状況マップで同一仕様にするため共通化している。
export function TrainDetailModal({
  train,
  color,
  fromDynmap = false,
  onClose,
}: {
  train: TrainRunState
  color: string
  fromDynmap?: boolean // 到着予想が出せないときの説明文の出し分け
  onClose: () => void
}) {
  const t = train
  const d = delayInfo(t.status, t.delayMinutes)
  // 増結: 自列車＋併結相手をまとめて扱う
  const members = [{ operationId: t.operationId, trainNumber: t.trainNumber }, ...(t.coupledWith || [])]
  const isCoupled = members.length > 1
  const trainNos = members.map((m) => m.trainNumber).filter(Boolean)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <span
            className="whitespace-nowrap rounded px-1.5 py-0.5 text-sm font-bold text-white"
            style={{ backgroundColor: color }}
          >
            {abbrevSyubetsu(t.routeName) || t.operationId}
          </span>
          <span className="min-w-0 truncate text-base font-bold">{formatHeadsign(t.headsign, t.headsignNote)}</span>
          {t.isExtra && (
            <span className="whitespace-nowrap rounded bg-rose-600 px-1.5 py-0.5 text-xs font-bold text-white">
              臨時
            </span>
          )}
          {isCoupled && (
            <span className="whitespace-nowrap rounded bg-amber-500 px-1.5 py-0.5 text-xs font-bold text-white">
              増結
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent"
            aria-label="閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">運用番号</dt>
          <dd className="font-medium">{members.map((m) => m.operationId).join("・")}</dd>
          {trainNos.length > 0 && (
            <>
              <dt className="text-muted-foreground">列車番号</dt>
              <dd className="font-medium tabular-nums">{trainNos.join(" + ")}</dd>
            </>
          )}
          <dt className="text-muted-foreground">種別</dt>
          <dd className="font-medium">
            {t.routeName}
            {t.isExtra && <span className="ml-1 text-xs text-muted-foreground">（Dynmapの表示）</span>}
          </dd>
          <dt className="text-muted-foreground">行先</dt>
          <dd className="font-medium">{formatHeadsign(t.headsign, t.headsignNote) || "—"}</dd>
          <dt className="text-muted-foreground">使用車両</dt>
          <dd className="flex flex-col gap-1 font-medium">
            {members.map((m, mi) => {
              const assigned = vehicleManager.getCachedVehicleForOperation(m.operationId)
              // 先頭(自列車)のみDynmapのアイコンから形式を判定できる場合がある
              const byIcon = mi === 0 ? vehicleForDynmapIcon(t.dynmapIcon) : null
              // アイコンで形式が分かる場合は、車両未登録でもそちらを優先（運用割当は予定にすぎない）
              const iconName = mi === 0 && !byIcon ? vehicleNameForDynmapIcon(t.dynmapIcon) : null
              const v = byIcon || (iconName ? null : assigned)
              return (
                <span key={m.operationId} className="flex items-center gap-1.5">
                  {isCoupled && (
                    <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                      {m.trainNumber || m.operationId}
                    </span>
                  )}
                  {v?.iconUrl && <img src={v.iconUrl} alt="" className="h-6 w-auto object-contain" />}
                  {v ? (
                    <span>
                      {v.name}
                      {byIcon && <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">実車両</span>}
                    </span>
                  ) : iconName ? (
                    // 車両管理に未登録でも、アイコンから形式名だけは分かる
                    <span>
                      {iconName}
                      <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">未登録</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">未割当</span>
                  )}
                </span>
              )
            })}
          </dd>
          <dt className="text-muted-foreground">現在地</dt>
          <dd className="font-medium">
            {t.approxPosition
              ? `${t.fromStop} 付近`
              : t.atStation
                ? `${t.fromStop} 停車中`
                : `${t.fromStop} → ${t.toStop} 走行中`}
          </dd>
          <dt className="text-muted-foreground">遅延</dt>
          <dd className="font-medium" style={{ color: d.delayed ? d.color : undefined }}>
            {d.text}
          </dd>
        </dl>
        {t.upcoming && t.upcoming.length > 0 ? (
          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">これからの停車駅（到着予定）</p>
            <div className="flex flex-col gap-1">
              {t.upcoming.map((u, i) => (
                <div key={i} className="flex items-center justify-between rounded border border-border px-2 py-1 text-sm">
                  <span className="font-medium">{u.name}</span>
                  <span className="tabular-nums text-muted-foreground">{u.time} 着</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            {t.isDeadhead
              ? "回送のため、行先・到着予想は表示しません。"
              : t.isExtra
              ? "ダイヤ上に該当の便が無い臨時列車のため、到着予想を表示できません（種別・行先は実車の表示によります）。"
              : fromDynmap
                ? "この運用はダイヤ上に見つからないため到着予想を表示できません。"
                : "この先の停車駅情報がありません。"}
          </p>
        )}
      </div>
    </div>
  )
}
