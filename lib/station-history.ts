// よく使う駅のサジェスト用に、最近選んだ駅/停留所のIDを localStorage に保持する。
const KEY = "kannan-recent-stops"
const MAX = 8

export function getRecentStopIds(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []
  } catch {
    return []
  }
}

export function addRecentStopId(id: string): void {
  if (typeof window === "undefined" || !id) return
  try {
    const cur = getRecentStopIds().filter((x) => x !== id)
    cur.unshift(id)
    window.localStorage.setItem(KEY, JSON.stringify(cur.slice(0, MAX)))
  } catch {
    // localStorage 不可でも検索自体は動くので無視
  }
}
