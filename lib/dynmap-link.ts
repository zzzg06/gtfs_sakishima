// Dynmap（サーバーのライブ地図）の任意地点へのリンクを組み立てる。
// Dynmap 2.6 の map.js は ?worldname=&mapname=&x=&y=&z=&zoom= を読んで初期表示位置を決める。
// nogui=true でチャット等のUIを消せるので、アプリ内にiframeで埋め込むときに使う。
//
// 駅座標(station-coordinates)はX/Zしか持たないため、Yはワールドの海面(64)を既定にする。

// 配信元。サーバー側APIの DYNMAP_BASE_URL と同じ値を既定にしている
// （クライアントからも使うため、上書きするときは NEXT_PUBLIC_DYNMAP_BASE_URL を設定する）。
export const DYNMAP_BASE_URL = (
  process.env.NEXT_PUBLIC_DYNMAP_BASE_URL || "https://meiserver.sakishima.net:60100"
).replace(/\/+$/, "")

const DEFAULT_WORLD = "world"
const DEFAULT_MAP = "flat" // もう一方は "surface"（斜め視点）
const SEA_LEVEL = 64

export interface DynmapLinkOptions {
  world?: string
  map?: string
  zoom?: number // 大きいほど拡大。駅周辺は 5〜6 くらいが見やすい
  y?: number
  nogui?: boolean // 埋め込み用にDynmapのUIを隠す
}

export function buildDynmapUrl(x: number, z: number, options: DynmapLinkOptions = {}): string {
  const p = new URLSearchParams()
  p.set("worldname", options.world || DEFAULT_WORLD)
  p.set("mapname", options.map || DEFAULT_MAP)
  p.set("zoom", String(options.zoom ?? 5))
  p.set("x", String(Math.round(x)))
  p.set("y", String(Math.round(options.y ?? SEA_LEVEL)))
  p.set("z", String(Math.round(z)))
  if (options.nogui) p.set("nogui", "true")
  return `${DYNMAP_BASE_URL}/?${p.toString()}`
}
