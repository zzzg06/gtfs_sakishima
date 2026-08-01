import { gtfsParser, type GTFSStop, type GTFSStopTime, type GTFSTrip, type GTFSRoute } from "./gtfs-parser"
import { getCachedTripVisibilitySettings } from "./delay-manager"
import { getCachedRouteSettings } from "./route-settings"
import { findWalkPath } from "./walk-list"
import { ENTRANCE_TO_STATION, findTaxiRide, taxiDestinationsFrom, TAXI_WAIT_MINUTES, type TaxiRide } from "./taxi-routes"

export interface RouteSegment {
  route: GTFSRoute
  trip: GTFSTrip
  fromStop: GTFSStop
  toStop: GTFSStop
  departureTime: string
  arrivalTime: string
  stopSequenceFrom: number
  stopSequenceTo: number
  type: "transit" // セグメントタイプを明示的に指定
}

export interface WalkingSegment {
  fromStop: GTFSStop
  toStop: GTFSStop
  departureTime: string
  arrivalTime: string
  distance: number // メートル単位
  duration: number // 分単位
  type: "walking"
  mode?: "walk" | "taxi" // taxi=デマンドタクシー（呼び出し待ちを含む）。省略時は徒歩
  waitMinutes?: number // タクシーの呼び出し待ち（分）
}

export type TransitSegment = RouteSegment | WalkingSegment

// 推奨バッジ: 早=最速で到着 / 楽=乗換が最少 / 短=所要時間が最短
export type RouteBadge = "fast" | "easy" | "short"

export interface TransitRoute {
  segments: TransitSegment[] // 徒歩区間も含むよう変更
  totalDuration: number
  transfers: number
  departureTime: string
  arrivalTime: string
  walkingDistance: number // 総徒歩距離を追加
}

export interface TransportOptions {
  allowWalking: boolean
  allowBus: boolean
  preferBus?: boolean
  showExcludedTrips?: boolean // 除外運用表示オプションを追加
  allowTaxi?: boolean // タクシー利用オプションを追加
}

export class RouteFinder {
  private readonly MAX_TRANSFER_WAIT_TIME = 20 // 最大乗り換え待ち時間（分）
  // 交通手段が切り替わる乗換（列車⇄バス、乗物⇄徒歩）に最低限必要な乗換時間（分）。
  // (バス)〇〇駅 と 〇〇 は同一駅扱いだが、ホーム⇄バス停の移動に要するため最低4分とする。
  private readonly MIN_MODE_CHANGE_TRANSFER = 4

  // 2つの区間の交通種別が異なる（列車⇄バス）かどうか
  private isModeChange(a: GTFSRoute, b: GTFSRoute): boolean {
    return (a.route_type === 3) !== (b.route_type === 3)
  }

  // 徒歩区間リスト（walk-list）で、指定駅/停留所から徒歩到達できるGTFS駅・停留所を返す（単独 or Y連続）
  private getWalkAccessStops(stopId: string): { stopId: string; time: number }[] {
    const stop = gtfsParser.getStop(stopId)
    if (!stop) return []
    const out: { stopId: string; time: number }[] = []
    for (const target of gtfsParser.getStops()) {
      if (target.stop_id === stopId) continue
      const wp = findWalkPath(stop.stop_name, target.stop_name)
      if (wp) out.push({ stopId: target.stop_id, time: wp.time })
    }
    // 近い順に絞る（探索コスト抑制）
    return out.sort((a, b) => a.time - b.time).slice(0, 8)
  }

  private makeWalkSegment(
    fromStop: GTFSStop,
    toStop: GTFSStop,
    departureTime: string,
    minutes: number,
  ): WalkingSegment {
    return {
      fromStop,
      toStop,
      departureTime,
      arrivalTime: this.minutesToTime(this.timeToMinutes(departureTime) + minutes),
      distance: 0,
      duration: minutes,
      type: "walking",
    }
  }

  // Convert time string to minutes since midnight
  private timeToMinutes(timeStr: string): number {
    const [hours, minutes, seconds] = timeStr.split(":").map(Number)
    return hours * 60 + minutes + (seconds || 0) / 60
  }

  // Convert minutes since midnight to time string
  private minutesToTime(minutes: number): string {
    const hours = Math.floor(minutes / 60)
    const mins = Math.floor(minutes % 60)
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`
  }

  // trip_id → 発車順ソート済みstop_times のメモ化マップ（探索が多数のfindDirectRoutesを呼ぶため）
  private tripStopTimesCache: Map<string, GTFSStopTime[]> | null = null
  private tripStopTimesCacheKey = -1

  private getTripStopTimesMap(): Map<string, GTFSStopTime[]> {
    const stopTimes = gtfsParser.getStopTimes()
    if (this.tripStopTimesCache && this.tripStopTimesCacheKey === stopTimes.length) {
      return this.tripStopTimesCache
    }
    const map = new Map<string, GTFSStopTime[]>()
    stopTimes.forEach((st) => {
      if (!map.has(st.trip_id)) map.set(st.trip_id, [])
      map.get(st.trip_id)!.push(st)
    })
    for (const arr of map.values()) arr.sort((a, b) => a.stop_sequence - b.stop_sequence)
    this.tripStopTimesCache = map
    this.tripStopTimesCacheKey = stopTimes.length
    return map
  }

  // Find direct routes between two stops
  private findDirectRoutes(fromStopId: string, toStopId: string, departureTime?: string): RouteSegment[] {
    const segments: RouteSegment[] = []
    const departureMinutes = departureTime ? this.timeToMinutes(departureTime) : 0

    // 同一駅グループを取得
    const fromStopIds = gtfsParser.getRelatedStopIds(fromStopId)
    const toStopIds = gtfsParser.getRelatedStopIds(toStopId)

    const tripStopTimes = this.getTripStopTimesMap()

    // Check each trip for direct connection
    tripStopTimes.forEach((sortedStops, tripId) => {
      const trip = gtfsParser.getTrip(tripId)
      if (!trip) return

      let fromStopTime: GTFSStopTime | null = null
      let toStopTime: GTFSStopTime | null = null

      for (const stopTime of sortedStops) {
        // 出発駅の同一駅グループをチェック
        if (fromStopIds.includes(stopTime.stop_id)) {
          fromStopTime = stopTime
        }
        // 到着駅の同一駅グループをチェック（出発駅が見つかった後のみ）
        else if (toStopIds.includes(stopTime.stop_id) && fromStopTime) {
          toStopTime = stopTime
          break
        }
      }

      if (fromStopTime && toStopTime) {
        const route = gtfsParser.getRoute(trip.route_id)
        const fromStop = gtfsParser.getStop(fromStopId) // 元の指定駅を使用
        const toStop = gtfsParser.getStop(toStopId) // 元の指定駅を使用

        if (route && fromStop && toStop) {
          const depMinutes = this.timeToMinutes(fromStopTime.departure_time)

          // Filter by departure time if specified
          if (!departureTime || depMinutes >= departureMinutes) {
            segments.push({
              route,
              trip,
              fromStop,
              toStop,
              departureTime: fromStopTime.departure_time,
              arrivalTime: toStopTime.arrival_time,
              stopSequenceFrom: fromStopTime.stop_sequence,
              stopSequenceTo: toStopTime.stop_sequence,
              type: "transit",
            })
          }
        }
      }
    })

    return segments.sort((a, b) => this.timeToMinutes(a.departureTime) - this.timeToMinutes(b.departureTime))
  }

  // タクシーはデマンド方式（時刻表なし）。路線図に描かれた区間だけを、呼び出し待ちつきで乗れる。
  private makeTaxiSegment(
    fromStop: GTFSStop,
    toStop: GTFSStop,
    departureTime: string,
    ride: TaxiRide,
  ): WalkingSegment {
    const total = TAXI_WAIT_MINUTES + ride.minutes
    return {
      fromStop,
      toStop,
      departureTime,
      arrivalTime: this.minutesToTime(this.timeToMinutes(departureTime) + total),
      distance: 0,
      duration: total,
      type: "walking",
      mode: "taxi",
      waitMinutes: TAXI_WAIT_MINUTES,
    }
  }

  // タクシーを含む経路（デマンド方式。路線図に描かれた区間だけ利用できる）。
  // 検索フロー（use-route-search）から呼ぶ入口。
  findRoutesWithTaxi(
    fromStopId: string,
    toStopId: string,
    departureTime?: string,
    options?: TransportOptions,
  ): TransitRoute[] {
    if (!options?.allowTaxi) return []
    return [
      ...this.findTaxiOnlyRoutes(fromStopId, toStopId, departureTime),
      ...this.findRoutesWithTaxiAccess(fromStopId, toStopId, departureTime).slice(0, 3),
    ]
  }

  // タクシーで直接行ける場合（出発地と目的地が同じタクシー路線上にある）
  private findTaxiOnlyRoutes(fromStopId: string, toStopId: string, departureTime?: string): TransitRoute[] {
    const fromStop = gtfsParser.getStop(fromStopId)
    const toStop = gtfsParser.getStop(toStopId)
    if (!fromStop || !toStop) return []
    const ride = findTaxiRide(fromStop.stop_name, toStop.stop_name)
    if (!ride) return []
    const startMin = departureTime ? this.timeToMinutes(departureTime) : 8 * 60
    const seg = this.makeTaxiSegment(fromStop, toStop, this.minutesToTime(startMin), ride)
    return [
      {
        segments: [seg],
        totalDuration: seg.duration,
        transfers: 0,
        departureTime: seg.departureTime,
        arrivalTime: seg.arrivalTime,
        walkingDistance: 0,
      },
    ]
  }

  // タクシーで駅まで出て乗物に乗る／降りてからタクシーで目的地へ（片方だけでも可）。
  // タクシーの着発地点が駅の出入口（木古川駅東口など）の場合は、駅まで徒歩でつないで乗降する。
  private findRoutesWithTaxiAccess(fromStopId: string, toStopId: string, departureTime?: string): TransitRoute[] {
    const routes: TransitRoute[] = []
    const fromStop = gtfsParser.getStop(fromStopId)
    const toStop = gtfsParser.getStop(toStopId)
    if (!fromStop || !toStop) return routes
    const startMin = departureTime ? this.timeToMinutes(departureTime) : 8 * 60

    // タクシーで行ける地点 → 実際に乗降する駅（出入口なら駅まで徒歩を挟む）
    interface TaxiAccess {
      ride: TaxiRide
      dropStop: GTFSStop // タクシーの降り場（＝着発地点）
      boardStop: GTFSStop // 乗降する駅
      walkMinutes: number // 降り場から駅までの徒歩（0なら同じ場所）
      lead: number // 呼び出し待ち＋乗車＋徒歩
    }
    // タクシーの降り場そのもの＋そこから徒歩で行ける駅（徒歩リスト）を乗車候補にする。
    // 徒歩リストに無い着発地点（助が丘駅南口など）だけ ENTRANCE_TO_STATION で補う。
    const accessOf = (stop: GTFSStop): TaxiAccess[] => {
      const out: TaxiAccess[] = []
      for (const ride of taxiDestinationsFrom(stop.stop_name)) {
        const dropStop = gtfsParser.getStops().find((s) => s.stop_name === ride.to)
        if (!dropStop) continue

        const candidates: { boardStop: GTFSStop; walkMinutes: number }[] = [{ boardStop: dropStop, walkMinutes: 0 }]
        for (const target of gtfsParser.getStops()) {
          if (target.stop_id === dropStop.stop_id) continue
          const wp = findWalkPath(ride.to, target.stop_name)
          if (wp) candidates.push({ boardStop: target, walkMinutes: wp.time })
        }
        const entrance = ENTRANCE_TO_STATION[ride.to]
        if (entrance && !candidates.some((c) => c.boardStop.stop_name === entrance.station)) {
          const st = gtfsParser.getStops().find((s) => s.stop_name === entrance.station)
          if (st) candidates.push({ boardStop: st, walkMinutes: entrance.walkMinutes })
        }

        for (const c of candidates.sort((a, b) => a.walkMinutes - b.walkMinutes).slice(0, 3)) {
          out.push({
            ride,
            dropStop,
            boardStop: c.boardStop,
            walkMinutes: c.walkMinutes,
            lead: TAXI_WAIT_MINUTES + ride.minutes + c.walkMinutes,
          })
        }
      }
      return out
    }

    const origins = [
      { stopId: fromStopId, lead: 0, access: null as TaxiAccess | null },
      ...accessOf(fromStop).map((a) => ({ stopId: a.boardStop.stop_id, lead: a.lead, access: a })),
    ]
    const dests = [
      { stopId: toStopId, tail: 0, access: null as TaxiAccess | null },
      ...accessOf(toStop).map((a) => ({ stopId: a.boardStop.stop_id, tail: a.lead, access: a })),
    ]

    for (const o of origins) {
      for (const d of dests) {
        if (o.stopId === d.stopId) continue
        if (!o.access && !d.access) continue // タクシーを使わない組み合わせは他の探索が担当する
        const boardStop = gtfsParser.getStop(o.stopId)
        const alightStop = gtfsParser.getStop(d.stopId)
        if (!boardStop || !alightStop) continue

        const boardAfter = this.minutesToTime(startMin + o.lead)
        for (const transit of this.findDirectRoutes(o.stopId, d.stopId, boardAfter).slice(0, 2)) {
          const segments: TransitSegment[] = []
          let depTime = transit.departureTime
          if (o.access) {
            const a = o.access
            depTime = this.minutesToTime(this.timeToMinutes(transit.departureTime) - a.lead)
            segments.push(this.makeTaxiSegment(fromStop, a.dropStop, depTime, a.ride))
            if (a.walkMinutes > 0) {
              const taxiArr = this.minutesToTime(this.timeToMinutes(depTime) + TAXI_WAIT_MINUTES + a.ride.minutes)
              segments.push(this.makeWalkSegment(a.dropStop, a.boardStop, taxiArr, a.walkMinutes))
            }
          }
          segments.push(transit)
          let arrTime = transit.arrivalTime
          if (d.access) {
            const a = d.access
            let t = transit.arrivalTime
            if (a.walkMinutes > 0) {
              const w = this.makeWalkSegment(a.boardStop, a.dropStop, t, a.walkMinutes)
              segments.push(w)
              t = w.arrivalTime
            }
            const tail = this.makeTaxiSegment(a.dropStop, toStop, t, a.ride)
            segments.push(tail)
            arrTime = tail.arrivalTime
          }
          routes.push({
            segments,
            totalDuration: this.timeToMinutes(arrTime) - this.timeToMinutes(depTime),
            transfers: 0,
            departureTime: depTime,
            arrivalTime: arrTime,
            walkingDistance: 0,
          })
        }
      }
    }
    return routes.sort((a, b) => this.timeToMinutes(a.arrivalTime) - this.timeToMinutes(b.arrivalTime))
  }

  // 徒歩を含む経路（徒歩区間リストに基づく）。徒歩のみ／徒歩→列車／列車→徒歩。
  findRoutesWithWalking(
    fromStopId: string,
    toStopId: string,
    departureTime?: string,
    options?: TransportOptions,
  ): TransitRoute[] {
    const routes: TransitRoute[] = []
    const fromStop = gtfsParser.getStop(fromStopId)
    const toStop = gtfsParser.getStop(toStopId)
    if (!fromStop || !toStop) return routes

    const startMin = departureTime ? this.timeToMinutes(departureTime) : 8 * 60 // 指定なしは8:00を起点に表示

    // 1) 徒歩のみ（出発→到着が徒歩区間で繋がる場合）
    const walkOnly = findWalkPath(fromStop.stop_name, toStop.stop_name)
    if (walkOnly) {
      const seg = this.makeWalkSegment(fromStop, toStop, this.minutesToTime(startMin), walkOnly.time)
      routes.push({
        segments: [seg],
        totalDuration: walkOnly.time,
        transfers: 0,
        departureTime: seg.departureTime,
        arrivalTime: seg.arrivalTime,
        walkingDistance: 0,
      })
    }

    // 2) 徒歩 → 乗物 → 徒歩（出発側で歩いて乗車、到着側で降りて歩く。どちらか片方のみも可）
    // 乗車駅: 出発地自身＋徒歩で行ける駅/停留所、降車駅: 到着地自身＋徒歩で行ける駅/停留所
    const origins = [{ stopId: fromStopId, lead: 0 }, ...this.getWalkAccessStops(fromStopId).map((a) => ({ stopId: a.stopId, lead: a.time }))]
    const dests = [{ stopId: toStopId, tail: 0 }, ...this.getWalkAccessStops(toStopId).map((e) => ({ stopId: e.stopId, tail: e.time }))]

    for (const o of origins) {
      for (const d of dests) {
        if (o.stopId === d.stopId) continue
        // 両端とも徒歩なし＝純粋な直通は getDepartureBoard が担当するのでスキップ
        if (o.lead === 0 && d.tail === 0) continue

        const boardStop = gtfsParser.getStop(o.stopId)
        const alightStop = gtfsParser.getStop(d.stopId)
        if (!boardStop || !alightStop) continue

        const boardAfter = this.minutesToTime(startMin + o.lead)
        for (const transit of this.findDirectRoutes(o.stopId, d.stopId, boardAfter).slice(0, 2)) {
          const segments: TransitSegment[] = []
          let depTime = transit.departureTime
          if (o.lead > 0) {
            depTime = this.minutesToTime(this.timeToMinutes(transit.departureTime) - o.lead)
            segments.push(this.makeWalkSegment(fromStop, boardStop, depTime, o.lead))
          }
          segments.push(transit)
          let arrTime = transit.arrivalTime
          if (d.tail > 0) {
            const tailWalk = this.makeWalkSegment(alightStop, toStop, transit.arrivalTime, d.tail)
            segments.push(tailWalk)
            arrTime = tailWalk.arrivalTime
          }
          routes.push({
            segments,
            totalDuration: this.timeToMinutes(arrTime) - this.timeToMinutes(depTime),
            transfers: 0,
            departureTime: depTime,
            arrivalTime: arrTime,
            walkingDistance: 0,
          })
        }
      }
    }

    const transportOptions: TransportOptions = {
      allowWalking: true,
      allowBus: true,
      preferBus: false,
      showExcludedTrips: false,
      allowTaxi: false,
      ...options,
    }
    let filtered = this.filterRoutesByTransportOptions(routes, transportOptions)
    filtered = this.filterExcludedTrips(filtered, transportOptions.showExcludedTrips || false)
    return filtered.sort((a, b) => a.totalDuration - b.totalDuration)
  }

  // Find routes with transfers (simplified version)
  private findRoutesWithTransfers(fromStopId: string, toStopId: string, departureTime?: string): TransitRoute[] {
    const routes: TransitRoute[] = []
    const stops = gtfsParser.getStops()
    const maxTransfers = 2 // Limit to 2 transfers for performance

    // Find potential transfer stations (stations that have multiple routes)
    const transferStations = new Set<string>()
    const routesByStop = new Map<string, Set<string>>()

    gtfsParser.getStopTimes().forEach((st) => {
      const trip = gtfsParser.getTrip(st.trip_id)
      if (trip) {
        if (!routesByStop.has(st.stop_id)) {
          routesByStop.set(st.stop_id, new Set())
        }
        routesByStop.get(st.stop_id)!.add(trip.route_id)
      }
    })

    routesByStop.forEach((routes, stopId) => {
      if (routes.size > 1) {
        transferStations.add(stopId)
      }
    })

    // 同一駅グループを取得
    const fromStopIds = gtfsParser.getRelatedStopIds(fromStopId)
    const toStopIds = gtfsParser.getRelatedStopIds(toStopId)

    // Try one transfer
    for (const transferStopId of transferStations) {
      // 出発駅の同一駅グループから乗り換え駅への経路を検索
      for (const actualFromStopId of fromStopIds) {
        const firstSegments = this.findDirectRoutes(actualFromStopId, transferStopId, departureTime)

        for (const firstSegment of firstSegments.slice(0, 2)) {
          // Limit to first 2 options
          const transferTime = this.timeToMinutes(firstSegment.arrivalTime) + 5 // 5 min transfer time

          // 乗り換え駅から到着駅の同一駅グループへの経路を検索
          for (const actualToStopId of toStopIds) {
            const secondSegments = this.findDirectRoutes(
              transferStopId,
              actualToStopId,
              this.minutesToTime(transferTime),
            )

            for (const secondSegment of secondSegments.slice(0, 1)) {
              // Limit to first 1 option
              const waitTime =
                this.timeToMinutes(secondSegment.departureTime) - this.timeToMinutes(firstSegment.arrivalTime)

              if (waitTime > this.MAX_TRANSFER_WAIT_TIME) {
                continue // 待ち時間が20分を超える場合はスキップ
              }

              const totalDuration =
                this.timeToMinutes(secondSegment.arrivalTime) - this.timeToMinutes(firstSegment.departureTime)

              routes.push({
                segments: [firstSegment, secondSegment],
                totalDuration,
                transfers: 1,
                departureTime: firstSegment.departureTime,
                arrivalTime: secondSegment.arrivalTime,
                walkingDistance: 0,
              })
            }
          }
        }
      }
    }

    return routes.sort((a, b) => a.totalDuration - b.totalDuration)
  }

  private filterRoutesByTransportOptions(routes: TransitRoute[], options: TransportOptions): TransitRoute[] {
    return routes.filter((route) => {
      // 徒歩を使用しない場合、徒歩区間を含むルートを除外
      if (!options.allowWalking && route.segments.some((s) => s.type === "walking")) {
        return false
      }

      // バスを使用しない場合、バス区間を含むルートを除外
      if (!options.allowBus) {
        const hasBasSegment = route.segments.some((segment) => {
          if (segment.type === "transit") {
            return segment.route.route_type === 3 // route_type 3 = バス
          }
          return false
        })
        if (hasBasSegment) {
          return false
        }
      }

      if (!options.allowTaxi) {
        // タクシー区間（デマンド）を含む経路は、タクシーを許可していないときは出さない
        const hasTaxiSegment = route.segments.some((segment) => segment.type === "walking" && segment.mode === "taxi")
        if (hasTaxiSegment) {
          return false
        }
      }

      return true
    })
  }

  private sortRoutesByPreference(routes: TransitRoute[], options: TransportOptions): TransitRoute[] {
    if (options.preferBus) {
      return routes.sort((a, b) => {
        // バス区間を含むルートを優先
        const aHasBus = a.segments.some((segment) => segment.type === "transit" && segment.route.route_type === 3)
        const bHasBus = b.segments.some((segment) => segment.type === "transit" && segment.route.route_type === 3)

        if (aHasBus && !bHasBus) return -1
        if (!aHasBus && bHasBus) return 1

        // バス優先度が同じ場合は従来の並び順（乗り換え回数、所要時間）
        if (a.transfers !== b.transfers) {
          return a.transfers - b.transfers
        }
        return a.totalDuration - b.totalDuration
      })
    }

    // バス優先でない場合は従来の並び順
    return routes.sort((a, b) => {
      if (a.transfers !== b.transfers) {
        return a.transfers - b.transfers
      }
      return a.totalDuration - b.totalDuration
    })
  }

  // 直通列車を発車時刻順に全件返す「発車ボード」（1本前/1本後ナビゲーション用）
  // 1列車=1ルートなので重複なく、徒歩・乗換・タクシーを含まずシンプル
  getDepartureBoard(fromStopId: string, toStopId: string, options?: TransportOptions): TransitRoute[] {
    const transportOptions: TransportOptions = {
      allowWalking: true,
      allowBus: true,
      preferBus: false,
      showExcludedTrips: false,
      allowTaxi: false,
      ...options,
    }

    const segments = this.findDirectRoutes(fromStopId, toStopId) // 発車時刻順、タクシー除外
    let routes: TransitRoute[] = segments.map((segment) => ({
      segments: [segment],
      totalDuration: this.timeToMinutes(segment.arrivalTime) - this.timeToMinutes(segment.departureTime),
      transfers: 0,
      departureTime: segment.departureTime,
      arrivalTime: segment.arrivalTime,
      walkingDistance: 0,
    }))

    routes = this.filterRoutesByTransportOptions(routes, transportOptions)
    routes = this.filterExcludedTrips(routes, transportOptions.showExcludedTrips || false)

    return routes.sort((a, b) => this.timeToMinutes(a.departureTime) - this.timeToMinutes(b.departureTime))
  }

  // 1回乗り換えの経路を返す（直通が少ない区間でも実用的な候補を出すため）
  // 乗り換え許容時間（待ち時間）は管理画面の設定（maxTransferWaitMinutes）に従う
  findRoutesWithOneTransfer(
    fromStopId: string,
    toStopId: string,
    departureTime?: string,
    options?: TransportOptions,
  ): TransitRoute[] {
    const transportOptions: TransportOptions = {
      allowWalking: true,
      allowBus: true,
      preferBus: false,
      showExcludedTrips: false,
      allowTaxi: false,
      ...options,
    }

    const MIN_TRANSFER = 3 // 乗り換えに必要な最小時間（分）
    const maxWait = getCachedRouteSettings().maxTransferWaitMinutes
    const fromIds = new Set(gtfsParser.getRelatedStopIds(fromStopId))
    const toIds = new Set(gtfsParser.getRelatedStopIds(toStopId))

    const results: TransitRoute[] = []
    const seen = new Set<string>()

    for (const via of gtfsParser.getStops()) {
      // 乗り換え駅は出発・到着駅自身を除く
      if (fromIds.has(via.stop_id) || toIds.has(via.stop_id)) continue

      // 第1区間: 出発駅 → 乗り換え駅（指定時刻以降の早い3本）
      const firstLegs = this.findDirectRoutes(fromStopId, via.stop_id, departureTime).slice(0, 3)
      for (const first of firstLegs) {
        const firstArr = this.timeToMinutes(first.arrivalTime)

        // 第2区間: 乗り換え駅 → 到着駅（乗り換え時間以降、待ち時間が許容内）
        // 列車⇄バスの乗換は最低4分必要
        const secondLegs = this.findDirectRoutes(via.stop_id, toStopId, this.minutesToTime(firstArr + MIN_TRANSFER))
        const second = secondLegs.find((s) => {
          const minT = this.isModeChange(first.route, s.route) ? this.MIN_MODE_CHANGE_TRANSFER : MIN_TRANSFER
          const wait = this.timeToMinutes(s.departureTime) - firstArr
          return wait >= minT && wait <= maxWait
        })
        if (!second) continue

        const sig = `${first.trip.trip_id}|${via.stop_id}|${second.trip.trip_id}`
        if (seen.has(sig)) continue
        seen.add(sig)

        results.push({
          segments: [first, second],
          transfers: 1,
          departureTime: first.departureTime,
          arrivalTime: second.arrivalTime,
          totalDuration: this.timeToMinutes(second.arrivalTime) - this.timeToMinutes(first.departureTime),
          walkingDistance: 0,
        })
      }
      if (results.length >= 60) break // 探索打ち切り（過剰な候補を防ぐ）
    }

    let routes = this.filterRoutesByTransportOptions(results, transportOptions)
    routes = this.filterExcludedTrips(routes, transportOptions.showExcludedTrips || false)
    return routes
  }

  // 2回乗り換えの経路を返す（直通も1回乗り換えも無い区間向け。探索が重いので呼び出しは限定）
  findRoutesWithTwoTransfers(
    fromStopId: string,
    toStopId: string,
    departureTime?: string,
    options?: TransportOptions,
  ): TransitRoute[] {
    const transportOptions: TransportOptions = {
      allowWalking: true,
      allowBus: true,
      preferBus: false,
      showExcludedTrips: false,
      allowTaxi: false,
      ...options,
    }

    const MIN_TRANSFER = 3
    const maxWait = getCachedRouteSettings().maxTransferWaitMinutes
    const fromIds = new Set(gtfsParser.getRelatedStopIds(fromStopId))
    const toIds = new Set(gtfsParser.getRelatedStopIds(toStopId))
    const stops = gtfsParser.getStops()

    const results: TransitRoute[] = []
    const seen = new Set<string>()

    for (const v1 of stops) {
      if (fromIds.has(v1.stop_id) || toIds.has(v1.stop_id)) continue
      const firstLegs = this.findDirectRoutes(fromStopId, v1.stop_id, departureTime).slice(0, 2)
      if (firstLegs.length === 0) continue

      for (const first of firstLegs) {
        const firstArr = this.timeToMinutes(first.arrivalTime)

        for (const v2 of stops) {
          if (v2.stop_id === v1.stop_id || fromIds.has(v2.stop_id) || toIds.has(v2.stop_id)) continue
          const secondLegs = this.findDirectRoutes(v1.stop_id, v2.stop_id, this.minutesToTime(firstArr + MIN_TRANSFER))
          const second = secondLegs.find((s) => {
            const minT = this.isModeChange(first.route, s.route) ? this.MIN_MODE_CHANGE_TRANSFER : MIN_TRANSFER
            const wait = this.timeToMinutes(s.departureTime) - firstArr
            return wait >= minT && wait <= maxWait
          })
          if (!second) continue

          const secondArr = this.timeToMinutes(second.arrivalTime)
          const thirdLegs = this.findDirectRoutes(v2.stop_id, toStopId, this.minutesToTime(secondArr + MIN_TRANSFER))
          const third = thirdLegs.find((s) => {
            const minT = this.isModeChange(second.route, s.route) ? this.MIN_MODE_CHANGE_TRANSFER : MIN_TRANSFER
            const wait = this.timeToMinutes(s.departureTime) - secondArr
            return wait >= minT && wait <= maxWait
          })
          if (!third) continue

          const sig = `${first.trip.trip_id}|${second.trip.trip_id}|${third.trip.trip_id}`
          if (seen.has(sig)) continue
          seen.add(sig)

          results.push({
            segments: [first, second, third],
            transfers: 2,
            departureTime: first.departureTime,
            arrivalTime: third.arrivalTime,
            totalDuration: this.timeToMinutes(third.arrivalTime) - this.timeToMinutes(first.departureTime),
            walkingDistance: 0,
          })
        }
        if (results.length >= 80) break
      }
      if (results.length >= 80) break
    }

    let routes = this.filterRoutesByTransportOptions(results, transportOptions)
    routes = this.filterExcludedTrips(routes, transportOptions.showExcludedTrips || false)
    return routes
  }

  // 乗物 → 駅間徒歩 → 乗物 の経路（例: 鉄道で降りて別の停留所まで歩きバスに乗る）。
  // 既存の乗換（findRoutesWithOneTransfer）は同一駅グループ内での乗継のみ、徒歩（findRoutesWithWalking）は
  // 両端のアクセスのみを扱うため、両者の隙間にあたる「異なる駅/停留所を徒歩でつなぐ乗継」をここで補う。
  findRoutesWithTransitWalkTransit(
    fromStopId: string,
    toStopId: string,
    departureTime?: string,
    options?: TransportOptions,
  ): TransitRoute[] {
    const transportOptions: TransportOptions = {
      allowWalking: true,
      allowBus: true,
      preferBus: false,
      showExcludedTrips: false,
      allowTaxi: false,
      ...options,
    }
    // 徒歩を使わない設定なら、このパターンは成立しない
    if (!transportOptions.allowWalking) return []

    const maxWait = getCachedRouteSettings().maxTransferWaitMinutes
    const fromIds = new Set(gtfsParser.getRelatedStopIds(fromStopId))
    const toIds = new Set(gtfsParser.getRelatedStopIds(toStopId))

    const results: TransitRoute[] = []
    const seen = new Set<string>()

    for (const alight of gtfsParser.getStops()) {
      // 降車地は出発・到着駅自身を除く（自身なら直通/両端徒歩で別途カバー）
      if (fromIds.has(alight.stop_id) || toIds.has(alight.stop_id)) continue

      // この降車地から徒歩で行ける駅/停留所（無ければ重い直通探索をスキップ）
      const walkTargets = this.getWalkAccessStops(alight.stop_id).slice(0, 4)
      if (walkTargets.length === 0) continue

      // 第1区間: 出発駅 → 降車地（指定時刻以降の早い2本）
      const firstLegs = this.findDirectRoutes(fromStopId, alight.stop_id, departureTime).slice(0, 2)
      if (firstLegs.length === 0) continue

      const alightStop = gtfsParser.getStop(alight.stop_id)
      if (!alightStop) continue

      for (const first of firstLegs) {
        const firstArr = this.timeToMinutes(first.arrivalTime)

        for (const wt of walkTargets) {
          // 乗車地は出発・到着駅自身を除く
          if (fromIds.has(wt.stopId) || toIds.has(wt.stopId)) continue
          const boardStop = gtfsParser.getStop(wt.stopId)
          if (!boardStop) continue

          // 乗物⇄徒歩⇄乗物の乗換。徒歩時間と最低乗換時間(4分)の大きい方を確保する
          const minGap = Math.max(wt.time, this.MIN_MODE_CHANGE_TRANSFER)
          const boardReady = firstArr + minGap
          const secondLegs = this.findDirectRoutes(wt.stopId, toStopId, this.minutesToTime(boardReady))
          const second = secondLegs.find((s) => {
            const wait = this.timeToMinutes(s.departureTime) - boardReady
            // 同一便に降りて歩いて乗り直す無意味な経路を除外（乗り続ければ済む）
            if (gtfsParser.getBaseTripId(s.trip.trip_id) === gtfsParser.getBaseTripId(first.trip.trip_id)) return false
            return wait >= 0 && wait <= maxWait
          })
          if (!second) continue

          const sig = `${first.trip.trip_id}|${alight.stop_id}>${wt.stopId}|${second.trip.trip_id}`
          if (seen.has(sig)) continue
          seen.add(sig)

          const walkSeg = this.makeWalkSegment(alightStop, boardStop, first.arrivalTime, wt.time)

          results.push({
            segments: [first, walkSeg, second],
            transfers: 1,
            departureTime: first.departureTime,
            arrivalTime: second.arrivalTime,
            totalDuration: this.timeToMinutes(second.arrivalTime) - this.timeToMinutes(first.departureTime),
            walkingDistance: 0,
          })
        }
      }
      if (results.length >= 40) break // 探索打ち切り（過剰な候補を防ぐ）
    }

    let routes = this.filterRoutesByTransportOptions(results, transportOptions)
    routes = this.filterExcludedTrips(routes, transportOptions.showExcludedTrips || false)
    return routes
  }

  // Main route finding method
  findRoutes(fromStopId: string, toStopId: string, departureTime?: string, options?: TransportOptions): TransitRoute[] {
    const routes: TransitRoute[] = []

    const transportOptions: TransportOptions = {
      allowWalking: true,
      allowBus: true,
      preferBus: false,
      showExcludedTrips: false,
      allowTaxi: false, // タクシーのデフォルト値を追加
      ...options,
    }

    // Find direct routes
    const directSegments = this.findDirectRoutes(fromStopId, toStopId, departureTime)
    directSegments.slice(0, 5).forEach((segment) => {
      // Limit to 5 direct routes
      const duration = this.timeToMinutes(segment.arrivalTime) - this.timeToMinutes(segment.departureTime)
      routes.push({
        segments: [segment],
        totalDuration: duration,
        transfers: 0,
        departureTime: segment.departureTime,
        arrivalTime: segment.arrivalTime,
        walkingDistance: 0, // 徒歩距離を追加
      })
    })

    if (transportOptions.allowTaxi) {
      // タクシー路線図の区間だけを使う: 直接乗れる場合と、最寄り駅までの足として使う場合
      routes.push(...this.findTaxiOnlyRoutes(fromStopId, toStopId, departureTime))
      routes.push(...this.findRoutesWithTaxiAccess(fromStopId, toStopId, departureTime).slice(0, 3))
    }

    if (transportOptions.allowWalking) {
      const walkingRoutes = this.findRoutesWithWalking(fromStopId, toStopId, departureTime)
      routes.push(...walkingRoutes.slice(0, 3)) // 最大3ルートまで追加
    }

    // Find routes with transfers if no direct routes or if we want more options
    if (routes.length < 3) {
      const transferRoutes = this.findRoutesWithTransfers(fromStopId, toStopId, departureTime)
      routes.push(...transferRoutes.slice(0, 3)) // Add up to 3 transfer routes
    }

    const filteredRoutes = this.filterRoutesByTransportOptions(routes, transportOptions)

    const visibilityFilteredRoutes = this.filterExcludedTrips(
      filteredRoutes,
      transportOptions.showExcludedTrips || false,
    )

    const nonWalkingOnlyRoutes = visibilityFilteredRoutes.filter((route) => {
      // 全てのセグメントが徒歩の場合は除外
      return !route.segments.every((segment) => segment.type === "walking")
    })

    // Apply bus preference sorting
    return this.sortRoutesByPreference(nonWalkingOnlyRoutes, transportOptions).slice(0, 5) // Return top 5 routes
  }

  private filterExcludedTrips(routes: TransitRoute[], showExcludedTrips: boolean): TransitRoute[] {
    if (showExcludedTrips) {
      return routes // 除外運用も表示する場合はフィルタリングしない
    }

    // 運用の表示設定を取得（事前にdelayManager.loadTripVisibilitySettings()で読み込まれたキャッシュ）
    const visibilitySettings = getCachedTripVisibilitySettings()

    return routes.filter((route) => {
      // 各セグメントの運用が表示設定されているかチェック
      return route.segments.every((segment) => {
        if (segment.type === "walking") {
          return true // 徒歩区間は常に表示
        }

        // 繰り返し展開した複製便は元の基本便の表示設定に従う
        const tripId = segment.trip.base_trip_id ?? segment.trip.trip_id
        // デフォルトはtrue（表示）、明示的にfalseに設定された場合のみ除外
        return visibilitySettings[tripId] !== false
      })
    })
  }
}

export const routeFinder = new RouteFinder()
