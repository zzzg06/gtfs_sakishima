import { promises as fs } from "fs"
import path from "path"

// ランタイムデータのファイル永続化（サーバー専用）
//
// ローカル・自前サーバーでは data/runtime/ に保存され、再起動後もデータが残る。
// Vercel等のサーバーレス環境ではファイルシステムが書き込み不可・揮発性のため、
// 書き込み失敗時はメモリのみで動作する（同梱データは常に利用可能）。

const runtimeDir = path.join(process.cwd(), "data", "runtime")

export async function readJsonFile<T>(fileName: string): Promise<T | null> {
  try {
    const content = await fs.readFile(path.join(runtimeDir, fileName), "utf8")
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

export async function writeJsonFile(fileName: string, data: unknown): Promise<boolean> {
  try {
    await fs.mkdir(runtimeDir, { recursive: true })
    await fs.writeFile(path.join(runtimeDir, fileName), JSON.stringify(data), "utf8")
    return true
  } catch (error) {
    console.warn(`[gtfs] ${fileName} のファイル保存に失敗（メモリのみで動作継続）:`, error)
    return false
  }
}
