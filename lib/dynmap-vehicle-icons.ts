import { getCachedVehicles, type Vehicle } from "./vehicle-manager"

// Dynmap(RTM)マーカーのアイコン名から「どの車両か」を決めるための対応表。
//
// MC側の SakishimaDynmapExtension は、車両モデル名 → Dynmapアイコン名 を
// modelIconMappings で割り当てている（例: kr3000 → kr3000_32、kuraBus → krbus32）。
// マーカーのアイコン名が分かれば形式が特定できるので、走行位置ではその車両として表示する。
//
// 対応が無いアイコン（common32 / exclamation など「指定なし」の既定アイコン）は
// 従来どおり管理画面の運用ごとの車両割当を使う。
//
// 個別に上書きしたい場合は、管理画面「車両管理」の各車両に Dynmapアイコン名 を設定する
// （Vehicle.dynmapIcon）。そちらが優先される。

// アイコン名 → 車両名（管理画面「車両管理」に登録されている名前と突き合わせる）
// MC側 sakishimadynmapextension.cfg の modelIconMappings に合わせて更新すること。
export const DEFAULT_ICON_TO_VEHICLE: Record<string, string> = {
  kr1000_32: "倉急1000系", // Kr1000
  kr1000yo_32: "倉急1000系（夜明け）", // Kraft1000-Yoake
  kr2000_32: "倉急2000系", // Kr2000 / Kr2300 が同じアイコン
  kr2500_32: "倉急2500系", // Kr2500
  kr2900_32: "倉急2900系", // Kr2900
  kr2900g_32: "倉急2900系（グリコラッピング）", // Org_Kr2900rap_fes
  kr3000_32: "倉急3000系", // kr3000
  kr3500_32: "倉急3500系", // kr3500
  kr20000_32: "倉急20000系", // Kr20000
  kr21000_32: "倉急21000系", // Kr_21000
  kr205_32: "倉急205系", // Kraft205
  kiha82_32: "キハ82系", // kiha82
  kiha110_32: "キハ110系", // kiha110
  kiha600_32: "キハ600形", // kiha600
  seta2200_32: "瀬田2200系", // TZ2200
  toda1000_32: "砥田1000系", // todaRNFC1000
  kiritramicon32: "桐立トラム", // 旧アイコン（現在のcfgには無いが、残っているマーカー向けに保持）
}

// バスのアイコン。バスは車両登録をしないので形式は特定せず「バスである」ことだけ分かればよい。
export const BUS_ICONS = new Set(["krbus32", "bus"])

// 鉄道でもバスでもない乗り物のアイコン（渡船・タクシー）。
// cfg では YukiyukiFerry / tofu_tosen / ASTA_namikaidoFerry / ASTA_JetFoil929 / unsraft_mi → tosen_32、
// Saki_Taxi → taxi_32。走行位置（在線盤・運行状況マップ）は鉄道の盤なので対象外にする。
export const NON_TRAIN_ICONS = new Set(["tosen_32", "taxi_32"])

export function isNonTrainIcon(icon?: string): boolean {
  return !!icon && NON_TRAIN_ICONS.has(icon)
}

export function isBusIcon(icon?: string): boolean {
  return !!icon && BUS_ICONS.has(icon)
}

// 車両を特定しない（＝指定なし）扱いにする既定アイコン。従来どおり運用の割当を使う。
export const UNSPECIFIED_ICONS = new Set(["common32", "default", "train", "exclamation", "", "truck", "anchor"])

export function isUnspecifiedIcon(icon?: string): boolean {
  return !icon || UNSPECIFIED_ICONS.has(icon) || isBusIcon(icon)
}

// アイコン名から車両を引く。
// (1) Dynmapアイコン名を設定した車両があればそれ (2) 既定の対応表の車両名で一致する車両
// どちらも無ければ null（＝呼び出し側で運用の割当にフォールバック）。
export function vehicleForDynmapIcon(icon?: string): Vehicle | null {
  if (isUnspecifiedIcon(icon)) return null
  const vehicles = getCachedVehicles()
  const explicit = vehicles.find((v) => v.dynmapIcon && v.dynmapIcon === icon)
  if (explicit) return explicit
  const name = DEFAULT_ICON_TO_VEHICLE[icon as string]
  if (!name) return null
  return vehicles.find((v) => v.name === name) || null
}

// 表示に使う車両。
// (1) アイコンで特定でき、車両管理にも登録がある → その車両（画像つき）
// (2) アイコンで形式は分かるが車両が未登録 → null（運用割当は実車と違う可能性が高いので使わず既定アイコン）
// (3) アイコンで分からない（指定なし・バス）→ 従来どおり運用に割り当てた車両
export function resolveDisplayVehicle(icon: string | undefined, assigned: Vehicle | null): Vehicle | null {
  const byIcon = vehicleForDynmapIcon(icon)
  if (byIcon) return byIcon
  if (vehicleNameForDynmapIcon(icon)) return null
  return assigned
}

// アイコンから車両名だけでも分かる場合の名前（車両が未登録でも形式名は出せる）
export function vehicleNameForDynmapIcon(icon?: string): string | null {
  if (isUnspecifiedIcon(icon)) return null
  return DEFAULT_ICON_TO_VEHICLE[icon as string] || null
}
