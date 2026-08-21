import { gtfsParser, type GTFSStop } from "./gtfs-parser"
import { getCachedStationCoordinates, stationCoordinateManager } from "./station-coordinates"

// Dynmapのマーカー（施設・観光地など）を「検索地点(POI)」として扱う。
// 駅・バス停はGTFS側にあるのでAPI側でセットごと除外済み（/api/dynmap-markers）。
//
// POIは時刻表を持たないため、GTFSの停留所としては登録せず、
// stop_id が "poi:" で始まる疑似停留所として経路検索の発着だけに使う。
// POIからの移動は「駅座標との直線距離 ÷ 徒歩速度」で徒歩区間にする。

export interface Poi {
  id: string // poi:<セットID>:<マーカーID>
  setId: string
  category: string
  name: string
  kind: string
  x: number
  z: number
}

// 直線距離の徒歩速度（ブロック/分）。実距離ではなく直線距離なので遅めに見積もる。
export const POI_WALK_BLOCKS_PER_MINUTE = 40
// POIから徒歩で向かえる上限（分）と、候補にする最寄り停留所の数
export const POI_MAX_WALK_MINUTES = 15
export const POI_MAX_ACCESS_STOPS = 2

const POI_PREFIX = "poi:"

let pois: Poi[] = []
let loaded = false
let loading: Promise<Poi[]> | null = null

export function isPoiId(stopId: string): boolean {
  return stopId.startsWith(POI_PREFIX)
}

export function isPoiStop(stop: { stop_id: string }): boolean {
  return isPoiId(stop.stop_id)
}

// POIをGTFSの停留所と同じ形にして、検索フォーム・経路結果でそのまま扱えるようにする。
// 座標(stop_lat/stop_lon)はGTFS側で使っていないため0でよい（距離計算はx/zで行う）。
export function poiToStop(p: Poi): GTFSStop {
  return {
    stop_id: p.id,
    stop_name: p.name,
    stop_lat: 0,
    stop_lon: 0,
    stop_desc: p.kind ? `${p.kind}` : undefined,
  }
}

export function getLoadedPois(): Poi[] {
  return pois
}

export async function loadPois(): Promise<Poi[]> {
  if (loaded) return pois
  if (loading) return loading
  loading = (async () => {
    try {
      const res = await fetch("/api/dynmap-markers").then((r) => r.json())
      if (res?.success && Array.isArray(res.pois)) {
        pois = res.pois as Poi[]
        loaded = true
      }
    } catch (error) {
      console.error("[gtfs] dynmap-markers の読み込みに失敗:", error)
    } finally {
      loading = null
    }
    return pois
  })()
  return loading
}

// 停留所名との突き合わせ用の正規化。
// スタンプの連番("2_なみなかアリーナ")やバス停の接頭辞("(バス)〇〇")を落として比べる。
function normalizeName(s: string): string {
  return (s || "")
    .normalize("NFKC")
    .replace(/\s/g, "")
    .replace(/^[（(]バス[)）]/, "")
    .replace(/^\d+[_\-.]/, "")
}

let stopNameCache: { count: number; names: Set<string> } | null = null
function existingStopNames(): Set<string> {
  const stops = gtfsParser.getStops()
  if (stopNameCache && stopNameCache.count === stops.length) return stopNameCache.names
  const names = new Set(stops.map((s) => normalizeName(s.stop_name)))
  stopNameCache = { count: stops.length, names }
  return names
}

// 検索候補に出せるPOI。
// - GTFSに同名の駅・バス停があるものは除く（スタンプやタクシー乗り場は停留所と重なることが多い）
// - 同じ名前がカテゴリ違いで重複する場合は最初の1件だけ残す
export function usablePois(): Poi[] {
  const taken = existingStopNames()
  const seen = new Set<string>()
  const out: Poi[] = []
  for (const p of pois) {
    const n = normalizeName(p.name)
    if (!n || taken.has(n) || seen.has(n)) continue
    seen.add(n)
    out.push(p)
  }
  return out
}

export function getPoi(id: string): Poi | null {
  if (!isPoiId(id)) return null
  return pois.find((p) => p.id === id) || null
}

export function getPoiByName(name: string): Poi | null {
  if (!name) return null
  return pois.find((p) => p.name === name) || null
}

// 検索ボックス用の簡易検索。名称・種別・カテゴリ名のいずれかに含まれれば候補にする。
export function searchPois(query: string, limit = 5): Poi[] {
  const q = (query || "").trim().normalize("NFKC")
  if (!q) return []
  const hit = (s: string) => s.normalize("NFKC").includes(q)
  return usablePois()
    .filter((p) => hit(p.name) || hit(p.kind) || hit(p.category))
    .slice(0, limit)
}

export interface PoiAccess {
  stop: GTFSStop // 乗降に使う実在の停留所
  minutes: number // POIとの徒歩時間（分）
  distance: number // 直線距離（ブロック）
}

// POIから徒歩で行ける停留所（最寄りから POI_MAX_ACCESS_STOPS 件、POI_MAX_WALK_MINUTES 以内）。
// 駅座標(station-coordinates)に登録がある停留所だけが対象。
export function poiAccessStops(p: Poi): PoiAccess[] {
  const coords = getCachedStationCoordinates()
  const byName = new Map<string, GTFSStop>()
  for (const s of gtfsParser.getStops()) if (!byName.has(s.stop_name)) byName.set(s.stop_name, s)

  const cands: PoiAccess[] = []
  for (const [name, c] of Object.entries(coords)) {
    const stop = byName.get(name)
    if (!stop) continue
    const distance = Math.hypot(p.x - c.x, p.z - c.z)
    const minutes = Math.max(1, Math.ceil(distance / POI_WALK_BLOCKS_PER_MINUTE))
    if (minutes > POI_MAX_WALK_MINUTES) continue
    cands.push({ stop, minutes, distance })
  }
  cands.sort((a, b) => a.distance - b.distance)
  return cands.slice(0, POI_MAX_ACCESS_STOPS)
}

// 経路検索の前に、POIと駅座標を読み込んでおく
export async function preparePois(): Promise<void> {
  await Promise.all([loadPois(), stationCoordinateManager.load()])
}
