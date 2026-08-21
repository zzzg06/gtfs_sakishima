import type { TransitRoute, WalkingSegment } from "./route-finder"
import type { GTFSStop } from "./gtfs-parser"
import type { PoiAccess } from "./poi-points"

// POI（Dynmapマーカー）を発着にした経路の組み立て。
// POI→停留所（またはその逆）は直線距離の徒歩区間として前後に付け足す。
//
// 「徒歩が重なる経路は出さない」ため、付け足す対象は徒歩区間を含まない経路だけに限る
// （POIの徒歩＋既存の徒歩乗換、という二重徒歩の候補を作らない）。

function timeToMinutes(t: string): number {
  const [h, m, s] = t.split(":").map(Number)
  return (h || 0) * 60 + (m || 0) + (s || 0) / 60
}

function minutesToTime(min: number): string {
  const total = Math.round(((min % 1440) + 1440) % 1440)
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
}

// 徒歩区間（タクシーを除く）を含む経路か
export function hasWalkingSegment(route: TransitRoute): boolean {
  return route.segments.some((s) => s.type === "walking" && s.mode !== "taxi")
}

function walkSegment(
  from: GTFSStop,
  to: GTFSStop,
  departure: string,
  minutes: number,
  distance: number,
  arrival?: string, // 乗車時刻ちょうどに着く場合など、到着を明示したいとき
): WalkingSegment {
  return {
    fromStop: from,
    toStop: to,
    departureTime: departure,
    arrivalTime: arrival ?? minutesToTime(timeToMinutes(departure) + minutes),
    distance: Math.round(distance),
    duration: minutes,
    type: "walking",
    mode: "walk",
  }
}

// 経路の前後にPOIの徒歩区間を付ける。access が null 側は何もしない。
export function attachPoiWalks(
  route: TransitRoute,
  from: { poiStop: GTFSStop; access: PoiAccess } | null,
  to: { poiStop: GTFSStop; access: PoiAccess } | null,
): TransitRoute {
  const segments = [...route.segments]
  let departureTime = route.departureTime
  let arrivalTime = route.arrivalTime
  let walkingDistance = route.walkingDistance

  if (from) {
    // 乗車時刻から逆算して、POIを出る時刻を決める
    // 分未満は切り捨てて逆算する（表示上の所要が徒歩時間より短く見えないように）
    departureTime = minutesToTime(Math.floor(timeToMinutes(route.departureTime)) - from.access.minutes)
    // 到着は乗車時刻そのもの（秒の丸めで1分ずれて見えないように明示する）
    const w = walkSegment(
      from.poiStop,
      from.access.stop,
      departureTime,
      from.access.minutes,
      from.access.distance,
      route.departureTime,
    )
    segments.unshift(w)
    walkingDistance += w.distance
  }
  if (to) {
    const w = walkSegment(to.access.stop, to.poiStop, route.arrivalTime, to.access.minutes, to.access.distance)
    segments.push(w)
    arrivalTime = w.arrivalTime
    walkingDistance += w.distance
  }

  return {
    ...route,
    segments,
    departureTime,
    arrivalTime,
    walkingDistance,
    totalDuration: Math.round(timeToMinutes(arrivalTime) - timeToMinutes(departureTime)),
  }
}

// 出発指定のとき、POIからの徒歩ぶんだけ遅らせた「乗車できる最早時刻」
export function shiftDepartureTime(time: string | undefined, walkMinutes: number): string | undefined {
  if (!time || walkMinutes <= 0) return time
  return minutesToTime(timeToMinutes(time) + walkMinutes).slice(0, 5)
}
