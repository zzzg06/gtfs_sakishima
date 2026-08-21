// Dynmap(RTM)のマーカーを在線状態(TrainRunState)へ変換する共通ロジック。
// /live の在線盤と管理画面の運行状況マップで同じ結果になるよう、ここに集約する。
//
// 呼び出し側は prevPos / lastDir を ref 等で保持して渡す（進行方向の判定に前回座標が要るため）。

import { locateOnNetwork } from "./locate-on-network"
import {
  headsignMatches,
  isBusOperationNumber,
  isExtraOperationNumber,
  matchOperationByHeadsign,
  normalizeHeadsign,
  resolveOperationNumber,
  syubetsuMatches,
} from "./operation-number"
import { isBusIcon, isNonTrainIcon } from "./dynmap-vehicle-icons"
import { resolveScheduledLeg, type OperationSchedule } from "./estimate-delay"
import type { StationCoordinates } from "./station-coordinates"
import type { TrainRunState } from "./train-position"

export interface RtmMarker {
  id: string
  runNo: string
  type: string
  dest: string
  destNote?: string // 行先の注記（「咲西浜臨停」など）。突き合わせには使わず表示だけに使う
  icon?: string
  x: number
  y: number
  z: number
}

// Dynmapのバスマーカー（前回座標つき。接近中判定の進行方向に使う）
export interface RtmBusMarker extends RtmMarker {
  prev?: { x: number; z: number }
}

// マーカーがバスか（運用番号が B0x／「バス」を含む、またはバスのアイコン）。列車は K0x。
// バスは車両登録をしないため、アイコンでバスと分かれば十分（形式は特定しない）。
export function isBusMarker(m: { runNo?: string; icon?: string }): boolean {
  return isBusOperationNumber(m.runNo || "") || isBusIcon(m.icon)
}

// 渡船・タクシーなど、鉄道でもバスでもない乗り物か。走行位置（在線盤・運行状況マップ）には出さない。
// アイコン（cfgの tosen_32 / taxi_32）で判定し、モデル未登録などでアイコンが既定になった場合に備えて
// ラベルの種別・行先に「渡船」等が入っていれば同様に除外する。
export function isNonTrainMarker(m: { icon?: string; type?: string; dest?: string }): boolean {
  if (isNonTrainIcon(m.icon)) return true
  return /渡船|フェリー/.test(`${m.type || ""}${m.dest || ""}`.normalize("NFKC"))
}

// 回送か（種別・行先のどちらかに「回送」が入っていれば回送とみなす）。
// 回送は営業列車ではないため、種別「回送」だけにまとめ、行先やダイヤ突き合わせは行わない。
export function isDeadheadMarker(m: { type?: string; dest?: string }): boolean {
  return `${m.type || ""}${m.dest || ""}`.normalize("NFKC").includes("回送")
}

export interface LocateRtmResult {
  states: TrainRunState[] // 線区に対応づいた列車
  unmapped: RtmMarker[] // 駅座標不足・線区から離れた位置で対応づかない列車
  buses: RtmBusMarker[] // バス（別ビューで扱う）
}

// マーカー群を駅座標で線区へ対応づける。prevPos/lastDir は破壊的に更新する（次回の方向判定に使う）。
export function locateRtmMarkers(params: {
  markers: RtmMarker[]
  coords: StationCoordinates
  prevPos: Map<string, { x: number; z: number }>
  lastDir: Map<string, number>
}): LocateRtmResult {
  const { markers, coords, prevPos, lastDir } = params
  const states: TrainRunState[] = []
  const unmapped: RtmMarker[] = []
  const buses: RtmBusMarker[] = []

  for (const tr of markers) {
    // 渡船・タクシーは鉄道でもバスでもないので、どちらのビューにも出さない
    if (isNonTrainMarker(tr)) continue
    // バス運用(B0x/「バス」)は鉄道盤・列車実位置から除外し、バス専用ビューへ回す。
    // ※暫定処置: 運用番号がバスならDynmapのアイコン種別に関わらず列車側には出さない。
    if (isBusMarker(tr)) {
      const prev = prevPos.get(tr.id)
      prevPos.set(tr.id, { x: tr.x, z: tr.z })
      buses.push({ ...tr, prev })
      continue
    }
    // 運用番号が未設定（ラベルが "[ ]"）の車両は走行位置に出さない。
    // 運用に紐づかず、どの列車か特定できないため（回送・入換等の車両）。
    if (!(tr.runNo || "").trim()) continue
    const loc = locateOnNetwork(tr.x, tr.z, coords)
    // 駅間が広い/曲線区間ほど直線への垂直距離が大きくなるため、区間長に応じた可変しきい値
    const thresh = loc ? Math.max(60, loc.chordLen * 0.6) : 0
    if (!loc || loc.perpDist > thresh) {
      unmapped.push(tr)
      continue
    }
    const a = coords[loc.aName]
    const b = coords[loc.bName]
    const prev = prevPos.get(tr.id)
    prevPos.set(tr.id, { x: tr.x, z: tr.z })
    // 方向は一定以上動いたときだけ更新し、それ以外は前回方向を保持（微小な揺れでの反転防止）
    let direction = lastDir.get(tr.id) ?? 0
    if (prev && a && b) {
      const mvx = tr.x - prev.x
      const mvz = tr.z - prev.z
      if (Math.hypot(mvx, mvz) >= 2) {
        const dot = mvx * (b.x - a.x) + mvz * (b.z - a.z)
        direction = dot >= 0 ? 0 : 1
        lastDir.set(tr.id, direction)
      }
    }
    // 回送は種別「回送」に統一し、行先は出さない
    const deadhead = isDeadheadMarker(tr)
    states.push({
      operationId: tr.runNo,
      tripId: tr.id,
      routeId: "__rtm__",
      routeName: deadhead ? "回送" : tr.type,
      routeType: 1,
      headsign: deadhead ? "" : tr.dest,
      headsignNote: deadhead ? undefined : tr.destNote,
      isDeadhead: deadhead || undefined,
      direction,
      status: "on-time",
      delayMinutes: 0,
      atStation: loc.atStation,
      fromStopId: "",
      toStopId: "",
      fromStop: loc.atStation ? loc.station || loc.aName : loc.aName,
      toStop: loc.atStation ? loc.station || loc.aName : loc.bName,
      nextStop: undefined,
      progress: loc.t,
      dynmapIcon: tr.icon,
    })
  }
  return { states, unmapped, buses }
}

// Dynmap実位置の列車を時刻表に対応づけ、種別・行先・進行方向・遅延・到着予想を解決して上書きする。
// 運用番号は表記ゆれ(K01/K1)を数字で吸収し、番号で決まらない場合は行先が一致する運行中の運用に紐づける。
// 位置が時刻表と噛み合わない(回送・ダイヤ外)場合でも、運用番号が特定できていれば運用番号だけは正規化する。
export function resolveRtmStatesWithSchedule(params: {
  states: TrainRunState[]
  operationSchedule: OperationSchedule
  trainOperationIds: string[]
  scheduleStates: TrainRunState[] // 行先マッチ用の「ダイヤ上いま走っている便」
  coords: StationCoordinates
  positionById?: Map<string, { x: number; z: number }> // 行先が複数一致したときの近さ判定用
  nowMinutes: number
}): TrainRunState[] {
  const { states, operationSchedule, trainOperationIds, scheduleStates, coords, positionById, nowMinutes } = params
  return states.map((s) => {
    // 回送はダイヤ上の便に当てない（種別「回送」のまま。行先・遅延・到着予想は出さない）。
    // 運用番号だけは車両割当が引けるよう正規化する。
    if (s.isDeadhead) {
      const op = resolveOperationNumber(s.operationId, trainOperationIds) || s.operationId
      return op === s.operationId ? s : { ...s, operationId: op }
    }
    // K99 は臨時運用の番号。ダイヤ上の運用ではないので突き合わせず、Dynmapの種別・行先をそのまま出す
    if (isExtraOperationNumber(s.operationId)) return { ...s, isExtra: true }
    const opId =
      resolveOperationNumber(s.operationId, trainOperationIds) ||
      matchOperationByHeadsign(s.headsign || "", false, scheduleStates, coords, positionById?.get(s.tripId)) ||
      s.operationId
    const r = resolveScheduledLeg(
      { operationId: opId, fromStop: s.fromStop, toStop: s.toStop, atStation: s.atStation, progress: s.progress },
      operationSchedule,
      nowMinutes,
    )
    // Dynmapのマーカーで種別・行先が設定されているか（臨時列車の判定に使う）
    const hasDynInfo = (s.routeName || "").trim() !== "" && normalizeHeadsign(s.headsign || "") !== ""
    // 種別/行先/遅延はダイヤで裏づけが取れたときだけ上書きする
    if (!r.matched) {
      const base = opId === s.operationId ? s : { ...s, operationId: opId }
      // ダイヤ上に該当便が無くても、Dynmapで種別・行先が設定されていれば臨時列車として表示する
      return hasDynInfo ? { ...base, isExtra: true } : base
    }
    // 運用番号ではダイヤ上の便に当たるが、Dynmapの種別・行先が食い違う場合は
    // その運用で走らせているスタフ外の列車とみなし、Dynmapの表示を優先する（遅延・到着予想は出さない）。
    // ダイヤ側に行先が無い便は突き合わせようがないので一致扱い（種別も syubetsuMatches が同様に扱う）
    const destOk = !normalizeHeadsign(r.headsign || "") || headsignMatches(s.headsign || "", r.headsign || "")
    if (hasDynInfo && !(destOk && syubetsuMatches(s.routeName, r.routeName || ""))) {
      return { ...s, operationId: opId, isExtra: true }
    }
    return {
      ...s,
      // 車両割当や運用詳細が時刻表の運用番号で引けるよう、正規化後の番号を使う
      operationId: opId,
      routeId: r.routeId || s.routeId,
      routeName: r.routeName || s.routeName,
      headsign: r.headsign ?? s.headsign,
      status: r.status,
      delayMinutes: r.delayMinutes,
      // 進行順(折り返し解決済み)で from→to を上書き → 線区ローカルの向きが正しく出る
      fromStop: s.atStation ? s.fromStop : r.travelFrom || s.fromStop,
      toStop: s.atStation ? s.toStop : r.travelTo || s.toStop,
      nextStop: s.atStation ? r.nextStop ?? s.nextStop : r.upcoming?.[0]?.name ?? s.nextStop,
      // 運用がダイヤ上にあれば、車両詳細で到着予想時刻を出す（遅延込み）
      upcoming: r.upcoming && r.upcoming.length > 0 ? r.upcoming : s.upcoming,
    }
  })
}
