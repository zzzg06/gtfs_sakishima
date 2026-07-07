import { GTFSStorage, type GTFSDataset } from "./gtfs-storage"
import embeddedBus from "@/data/embedded-bus.json"

export interface GTFSStop {
  stop_id: string
  stop_name: string
  stop_lat: number
  stop_lon: number
  location_type?: number
  parent_station?: string
  stop_desc?: string // ひらがな表記用のstop_descフィールドを追加
}

export interface GTFSRoute {
  route_id: string
  route_short_name: string
  route_long_name: string
  route_type: number
  route_color?: string
}

export interface GTFSTrip {
  route_id: string
  service_id: string
  trip_id: string
  trip_headsign?: string
  trip_short_name?: string // trip_short_nameフィールドを追加
  train_number?: string // 列車番号（スタフ由来。運用詳細表示用）
  direction_id?: number
  base_trip_id?: string // ダイヤ繰り返し展開で生成した便は、元になった基本便のtrip_idを持つ
}

export interface GTFSStopTime {
  trip_id: string
  arrival_time: string
  departure_time: string
  stop_id: string
  stop_sequence: number
  platform_code?: string
  drop_off_type?: number
  pass?: boolean // 通過駅（優等の駅飛ばし）。位置計算には使うが乗降不可＝時刻表・経路検索からは除外
}

export interface GTFSCalendar {
  service_id: string
  monday: number
  tuesday: number
  wednesday: number
  thursday: number
  friday: number
  saturday: number
  sunday: number
  start_date: string
  end_date: string
}

export class GTFSParser {
  private stops: Map<string, GTFSStop> = new Map()
  private routes: Map<string, GTFSRoute> = new Map()
  private trips: Map<string, GTFSTrip> = new Map()
  private stopTimes: GTFSStopTime[] = []
  private calendar: Map<string, GTFSCalendar> = new Map()
  private stationGroups: Map<string, string[]> = new Map() // 基本駅名 -> 関連stop_idリスト

  constructor() {
    // 自動読み込みは削除 - 明示的にloadFromStorageAsyncを呼び出す必要がある
  }

  private buildStationGroups(): void {
    this.stationGroups.clear()

    for (const stop of this.stops.values()) {
      const baseStationName = this.getBaseStationName(stop.stop_id)

      if (!this.stationGroups.has(baseStationName)) {
        this.stationGroups.set(baseStationName, [])
      }
      this.stationGroups.get(baseStationName)!.push(stop.stop_id)
    }
  }

  private getBaseStationName(stopId: string): string {
    // "_B"で終わる場合は、それを除いた部分を基本駅名とする
    if (stopId.endsWith("_B")) {
      return stopId.slice(0, -2)
    }
    return stopId
  }

  getRelatedStopIds(stopId: string): string[] {
    const baseStationName = this.getBaseStationName(stopId)
    return this.stationGroups.get(baseStationName) || [stopId]
  }

  // Parse CSV content into structured data
  private parseCSV(csvContent: string): any[] {
    // UTF-8 BOMを除去
    const cleanContent = csvContent.replace(/^\uFEFF/, "")
    const lines = cleanContent.trim().split(/\r?\n/)
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""))

    return lines.slice(1).map((line) => {
      const values = this.parseCSVLine(line)
      const obj: any = {}
      headers.forEach((header, index) => {
        // 日本語文字列の前後の空白とクォートを適切に処理
        const value = values[index] || ""
        obj[header] = value.replace(/^"|"$/g, "").trim()
      })
      return obj
    })
  }

  private parseCSVLine(line: string): string[] {
    const result: string[] = []
    let current = ""
    let inQuotes = false
    let i = 0

    while (i < line.length) {
      const char = line[i]

      if (char === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          // エスケープされたクォート
          current += '"'
          i += 2
        } else {
          inQuotes = !inQuotes
          i++
        }
      } else if (char === "," && !inQuotes) {
        result.push(current)
        current = ""
        i++
      } else {
        current += char
        i++
      }
    }

    result.push(current)
    return result
  }

  // Load GTFS data from CSV files
  async loadStops(csvContent: string) {
    const data = this.parseCSV(csvContent)
    data.forEach((row) => {
      const stop: GTFSStop = {
        stop_id: row.stop_id,
        stop_name: row.stop_name,
        stop_lat: Number.parseFloat(row.stop_lat),
        stop_lon: Number.parseFloat(row.stop_lon),
        location_type: Number.parseInt(row.location_type) || 0,
        parent_station: row.parent_station,
        stop_desc: row.stop_desc, // stop_descを読み込むよう追加
      }
      this.stops.set(stop.stop_id, stop)
    })
    this.buildStationGroups()
  }

  async loadRoutes(csvContent: string) {
    const data = this.parseCSV(csvContent)
    data.forEach((row) => {
      const route: GTFSRoute = {
        route_id: row.route_id,
        route_short_name: row.route_short_name,
        route_long_name: row.route_long_name,
        route_type: Number.parseInt(row.route_type),
        route_color: row.route_color,
      }
      this.routes.set(route.route_id, route)
    })
  }

  async loadTrips(csvContent: string) {
    const data = this.parseCSV(csvContent)
    data.forEach((row) => {
      const trip: GTFSTrip = {
        route_id: row.route_id,
        service_id: row.service_id,
        trip_id: row.trip_id,
        trip_headsign: row.trip_headsign,
        trip_short_name: row.trip_short_name, // trip_short_nameを読み込むよう追加
        train_number: row.train_number,
        direction_id: Number.parseInt(row.direction_id) || 0,
      }
      this.trips.set(trip.trip_id, trip)
    })
  }

  async loadStopTimes(csvContent: string) {
    const data = this.parseCSV(csvContent)
    this.stopTimes = data.map((row) => ({
      trip_id: row.trip_id,
      arrival_time: row.arrival_time,
      departure_time: row.departure_time,
      stop_id: row.stop_id,
      stop_sequence: Number.parseInt(row.stop_sequence),
      platform_code: row.platform_code,
      drop_off_type: Number.parseInt(row.drop_off_type) || 0,
      pass: row.pass === "1" || row.pass === "true" || undefined,
    }))
  }

  async loadCalendar(csvContent: string) {
    const data = this.parseCSV(csvContent)
    data.forEach((row) => {
      const calendar: GTFSCalendar = {
        service_id: row.service_id,
        monday: Number.parseInt(row.monday),
        tuesday: Number.parseInt(row.tuesday),
        wednesday: Number.parseInt(row.wednesday),
        thursday: Number.parseInt(row.thursday),
        friday: Number.parseInt(row.friday),
        saturday: Number.parseInt(row.saturday),
        sunday: Number.parseInt(row.sunday),
        start_date: row.start_date,
        end_date: row.end_date,
      }
      this.calendar.set(calendar.service_id, calendar)
    })
  }

  async loadFromStorageAsync(): Promise<void> {
    try {
      const activeDataset = await GTFSStorage.getActiveDataset()
      if (activeDataset) {
        console.log("[v0] ストレージからGTFSデータを読み込み中:", activeDataset.name)

        // Clear existing data
        this.clearData()

        // Load data into maps
        activeDataset.stops.forEach((stop) => this.stops.set(stop.stop_id, stop))
        activeDataset.routes.forEach((route) => this.routes.set(route.route_id, route))
        activeDataset.trips.forEach((trip) => this.trips.set(trip.trip_id, trip))
        this.stopTimes = activeDataset.stopTimes
        activeDataset.calendar.forEach((cal) => this.calendar.set(cal.service_id, cal))

        // 同梱のバスデータ（行路表由来）をネットワークにマージ
        this.mergeBusData()

        // 8〜11時台の基本ダイヤを4時間ごとに繰り返し、24時近くまで展開
        this.expandRepeatingSchedule()

        this.buildStationGroups()

        console.log("[v0] GTFSデータの読み込み完了:", {
          stops: this.stops.size,
          routes: this.routes.size,
          trips: this.trips.size,
          stopTimes: this.stopTimes.length,
          calendar: this.calendar.size,
        })
      } else {
        console.log("[v0] アクティブなデータセットが見つかりません")
      }
    } catch (error) {
      console.error("[v0] ストレージからのデータ読み込みに失敗:", error)
    }
  }

  // 同梱バスデータ（data/embedded-bus.json）を現在のネットワークに追加
  private mergeBusData(): void {
    const bus = embeddedBus as unknown as {
      stops: GTFSStop[]
      routes: GTFSRoute[]
      trips: GTFSTrip[]
      stopTimes: GTFSStopTime[]
      calendar: GTFSCalendar[]
    }
    if (!bus?.trips?.length) return
    bus.stops.forEach((s) => { if (!this.stops.has(s.stop_id)) this.stops.set(s.stop_id, s) })
    bus.routes.forEach((r) => { if (!this.routes.has(r.route_id)) this.routes.set(r.route_id, r) })
    bus.trips.forEach((t) => { if (!this.trips.has(t.trip_id)) this.trips.set(t.trip_id, t) })
    this.stopTimes = [...this.stopTimes, ...bus.stopTimes]
    bus.calendar.forEach((c) => { if (!this.calendar.has(c.service_id)) this.calendar.set(c.service_id, c) })
    console.log("[gtfs] バスデータをマージ:", { busStops: bus.stops.length, busTrips: bus.trips.length })
  }

  // 同梱データ（バス・列車とも）は8〜11時台の4時間分のみ。実際は同じ運用を4時間ごとに
  // 繰り返し、ほぼ24時まで運行する。基本便を +4h/+8h/+12h で複製し 8:00〜24:00 をカバーする。
  // 複製便は base_trip_id を持ち、getTrips()（管理一覧・保存）からは除外、検索系には含める。
  private readonly SCHEDULE_REPEAT_OFFSETS_H = [4, 8, 12]

  private expandRepeatingSchedule(): void {
    const baseTrips = Array.from(this.trips.values()).filter((t) => !t.base_trip_id)
    const stByTrip = new Map<string, GTFSStopTime[]>()
    for (const st of this.stopTimes) {
      if (!stByTrip.has(st.trip_id)) stByTrip.set(st.trip_id, [])
      stByTrip.get(st.trip_id)!.push(st)
    }
    const added: GTFSStopTime[] = []
    for (const off of this.SCHEDULE_REPEAT_OFFSETS_H) {
      for (const trip of baseTrips) {
        // タクシーは時刻非依存で別途処理するため複製しない
        if (this.routes.get(trip.route_id)?.route_id === "TAXI") continue
        const newId = `${trip.trip_id}__+${off}h`
        if (this.trips.has(newId)) continue
        this.trips.set(newId, { ...trip, trip_id: newId, base_trip_id: trip.trip_id })
        for (const st of stByTrip.get(trip.trip_id) || []) {
          added.push({
            ...st,
            trip_id: newId,
            arrival_time: this.shiftTimeByHours(st.arrival_time, off),
            departure_time: this.shiftTimeByHours(st.departure_time, off),
          })
        }
      }
    }
    this.stopTimes = [...this.stopTimes, ...added]
    console.log("[gtfs] ダイヤ繰り返し展開:", {
      baseTrips: baseTrips.length,
      totalTrips: this.trips.size,
      totalStopTimes: this.stopTimes.length,
    })
  }

  // "HH:MM:SS" に時間オフセットを加算（24時以降はGTFS慣習どおり "24:xx" 等で表現）
  private shiftTimeByHours(time: string, offsetHours: number): string {
    if (!time) return time
    const [h, m, s] = time.split(":")
    const hh = (parseInt(h, 10) || 0) + offsetHours
    return `${String(hh).padStart(2, "0")}:${m ?? "00"}:${s ?? "00"}`
  }

  // 繰り返し展開された便なら元の基本便のtrip_idを、そうでなければ自身のtrip_idを返す。
  // 運休・遅延・運用表示などtrip_id単位の設定を全サイクルに反映するために使う。
  getBaseTripId(tripId: string): string {
    return this.trips.get(tripId)?.base_trip_id || tripId
  }

  async saveToStorage(datasetName: string): Promise<void> {
    try {
      const dataset: GTFSDataset = {
        id: `dataset-${Date.now()}`,
        name: datasetName,
        uploadDate: new Date().toISOString(),
        stops: this.getStops(),
        routes: this.getRoutes(),
        trips: this.getTrips(), // 基本便のみ（繰り返し展開は読み込み時に再生成）
        // 繰り返し展開で生成した複製便のstop_timesは保存しない（二重展開を防ぐ）
        stopTimes: this.getAllStopTimes().filter((st) => !this.trips.get(st.trip_id)?.base_trip_id),
        calendar: this.getCalendar(),
      }

      await GTFSStorage.saveDataset(dataset)
      console.log("[v0] GTFSデータをサーバーに保存しました:", datasetName)
    } catch (error) {
      console.error("[v0] GTFSデータの保存に失敗:", error)
      throw error
    }
  }

  hasData(): boolean {
    return this.stops.size > 0 && this.routes.size > 0 && this.trips.size > 0 && this.stopTimes.length > 0
  }

  clearData(): void {
    this.stops.clear()
    this.routes.clear()
    this.trips.clear()
    this.stopTimes = []
    this.calendar.clear()
    this.stationGroups.clear()
    console.log("[v0] GTFSデータをクリアしました")
  }

  // Getter methods
  getStops(): GTFSStop[] {
    return Array.from(this.stops.values())
  }

  getStop(stopId: string): GTFSStop | undefined {
    return this.stops.get(stopId)
  }

  getRoutes(): GTFSRoute[] {
    return Array.from(this.routes.values())
  }

  getRoute(routeId: string): GTFSRoute | undefined {
    return this.routes.get(routeId)
  }

  getTrips(): GTFSTrip[] {
    // 繰り返し展開した複製便（base_trip_id付き）は除外し、基本便のみ返す（管理一覧・保存用）
    return Array.from(this.trips.values()).filter((t) => !t.base_trip_id)
  }

  getTrip(tripId: string): GTFSTrip | undefined {
    return this.trips.get(tripId)
  }

  // 乗降可能な停車のみ（通過駅 pass を除外）。時刻表・経路検索など「乗り降りできる駅」を扱う用途向け。
  getStopTimes(): GTFSStopTime[] {
    return this.stopTimes.filter((st) => !st.pass)
  }

  // 通過駅を含む全 stop_times。列車走行位置・遅延推定など「物理的にどこを走っているか」を扱う用途向け。
  getAllStopTimes(): GTFSStopTime[] {
    return this.stopTimes
  }

  getCalendar(): GTFSCalendar[] {
    return Array.from(this.calendar.values())
  }

  // Search functionality
  searchStops(query: string): GTFSStop[] {
    if (!query || query.trim().length === 0) {
      return []
    }

    // 検索クエリを正規化（全角・半角、ひらがな・カタカナの統一）
    const normalizedQuery = this.normalizeSearchQuery(query.trim())
    // ローマ字入力の場合はカナに変換した版でも照合（例: "kiritachi" → "キリタチ"）
    const romajiQuery = this.normalizeSearchQuery(romajiToKatakana(query.trim()))
    const hasRomaji = romajiQuery.length > 0

    const matches = (text: string) =>
      text.includes(normalizedQuery) || (hasRomaji && text.includes(romajiQuery))
    const startsWith = (text: string) =>
      text.startsWith(normalizedQuery) || (hasRomaji && text.startsWith(romajiQuery))

    return this.getStops()
      .filter((stop) => {
        const normalizedStopName = this.normalizeSearchQuery(stop.stop_name)
        const normalizedStopDesc = stop.stop_desc ? this.normalizeSearchQuery(stop.stop_desc) : ""
        return matches(normalizedStopName) || matches(normalizedStopDesc)
      })
      .sort((a, b) => {
        // 検索クエリ（駅名/読み、ローマ字）で始まるものを優先
        const aStartsWith = startsWith(this.normalizeSearchQuery(a.stop_name)) || (a.stop_desc ? startsWith(this.normalizeSearchQuery(a.stop_desc)) : false)
        const bStartsWith = startsWith(this.normalizeSearchQuery(b.stop_name)) || (b.stop_desc ? startsWith(this.normalizeSearchQuery(b.stop_desc)) : false)

        if (aStartsWith && !bStartsWith) return -1
        if (!aStartsWith && bStartsWith) return 1

        // 駅名の長さで並び替え（短い方を優先）
        return a.stop_name.length - b.stop_name.length
      })
  }

  // Get stop times for a specific stop
  getStopTimesForStop(stopId: string): GTFSStopTime[] {
    return this.stopTimes.filter((st) => st.stop_id === stopId)
  }

  // Get each trip's first departure time
  getFirstDepartureTimeForTrip(tripId: string): string | undefined {
    const tripStopTimes = this.stopTimes
      .filter((st) => st.trip_id === tripId)
      .sort((a, b) => a.stop_sequence - b.stop_sequence)

    return tripStopTimes.length > 0 ? tripStopTimes[0].departure_time : undefined
  }

  // Get trips for a specific route
  getTripsForRoute(routeId: string): GTFSTrip[] {
    return this.getTrips().filter((trip) => trip.route_id === routeId)
  }

  getStopTimeForTripAndStop(tripId: string, stopId: string): GTFSStopTime | undefined {
    return this.stopTimes.find((st) => st.trip_id === tripId && st.stop_id === stopId)
  }

  private normalizeSearchQuery(text: string): string {
    return (
      text
        .toLowerCase()
        // 全角英数字を半角に変換
        .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
        // ひらがなをカタカナに変換
        .replace(/[\u3041-\u3096]/g, (s) => String.fromCharCode(s.charCodeAt(0) + 0x60))
        // 長音符の統一
        .replace(/[ー−]/g, "ー")
        // 空白文字の統一
        .replace(/\s+/g, "")
    )
  }
}

// ローマ字（ヘボン式ゆらぎ含む）→ カタカナ。駅名の読み(stop_desc=ひらがな)検索をローマ字でも可能にする。
const ROMAJI_TABLE: Record<string, string> = {
  kya: "キャ", kyu: "キュ", kyo: "キョ", gya: "ギャ", gyu: "ギュ", gyo: "ギョ",
  sha: "シャ", shu: "シュ", sho: "ショ", sya: "シャ", syu: "シュ", syo: "ショ",
  ja: "ジャ", ju: "ジュ", jo: "ジョ", jya: "ジャ", jyu: "ジュ", jyo: "ジョ", zya: "ジャ", zyu: "ジュ", zyo: "ジョ",
  cha: "チャ", chu: "チュ", cho: "チョ", cya: "チャ", tya: "チャ", tyu: "チュ", tyo: "チョ",
  nya: "ニャ", nyu: "ニュ", nyo: "ニョ",
  hya: "ヒャ", hyu: "ヒュ", hyo: "ヒョ", bya: "ビャ", byu: "ビュ", byo: "ビョ", pya: "ピャ", pyu: "ピュ", pyo: "ピョ",
  mya: "ミャ", myu: "ミュ", myo: "ミョ", rya: "リャ", ryu: "リュ", ryo: "リョ",
  shi: "シ", chi: "チ", tsu: "ツ", tsi: "ツ", fu: "フ", hu: "フ", ji: "ジ", di: "ヂ", du: "ヅ",
  ka: "カ", ki: "キ", ku: "ク", ke: "ケ", ko: "コ",
  ga: "ガ", gi: "ギ", gu: "グ", ge: "ゲ", go: "ゴ",
  sa: "サ", si: "シ", su: "ス", se: "セ", so: "ソ",
  za: "ザ", zi: "ジ", zu: "ズ", ze: "ゼ", zo: "ゾ",
  ta: "タ", ti: "チ", tu: "ツ", te: "テ", to: "ト",
  da: "ダ", de: "デ", do: "ド",
  na: "ナ", ni: "ニ", nu: "ヌ", ne: "ネ", no: "ノ",
  ha: "ハ", hi: "ヒ", he: "ヘ", ho: "ホ",
  ba: "バ", bi: "ビ", bu: "ブ", be: "ベ", bo: "ボ",
  pa: "パ", pi: "ピ", pu: "プ", pe: "ペ", po: "ポ",
  ma: "マ", mi: "ミ", mu: "ム", me: "メ", mo: "モ",
  ya: "ヤ", yu: "ユ", yo: "ヨ",
  ra: "ラ", ri: "リ", ru: "ル", re: "レ", ro: "ロ",
  wa: "ワ", wo: "ヲ", we: "ウェ", wi: "ウィ",
  fa: "ファ", fi: "フィ", fe: "フェ", fo: "フォ",
  a: "ア", i: "イ", u: "ウ", e: "エ", o: "オ", n: "ン",
}

export function romajiToKatakana(input: string): string {
  const s = (input || "").toLowerCase().replace(/[^a-z]/g, "")
  if (!s) return ""
  let out = ""
  let i = 0
  while (i < s.length) {
    // 「nn」は撥音「ン」1つ
    if (s[i] === "n" && s[i + 1] === "n") {
      out += "ン"
      i += 2
      continue
    }
    // 促音: 同じ子音の連続（母音・nを除く）→ ッ
    if (i + 1 < s.length && s[i] === s[i + 1] && !"aeioun".includes(s[i])) {
      out += "ッ"
      i++
      continue
    }
    let matched = false
    for (let len = 3; len >= 1; len--) {
      const chunk = s.slice(i, i + len)
      if (ROMAJI_TABLE[chunk]) {
        out += ROMAJI_TABLE[chunk]
        i += len
        matched = true
        break
      }
    }
    if (!matched) i++ // 未知の文字はスキップ
  }
  return out
}

// Singleton instance
export const gtfsParser = new GTFSParser()
