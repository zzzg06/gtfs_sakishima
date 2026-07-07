import { type NextRequest, NextResponse } from "next/server"
import type { GTFSDataset } from "@/lib/gtfs-storage"
import { readJsonFile, writeJsonFile } from "@/lib/server/file-store"
import { getRequestSession } from "@/lib/server/session"
import embeddedData from "@/data/embedded-gtfs.json"

// GTFSデータセットAPI
//
// ダイヤデータはアプリに同梱（data/embedded-gtfs.json、scripts/convert-oud2.mjs で生成）。
// 同梱データはビルドに含まれるため、サーバーレス環境でも常に利用できる。
// 管理画面からアップロードしたデータセットは data/runtime/ にファイル保存され、
// 書き込み不可の環境ではメモリ保持（インスタンス再起動で消えるが同梱データは残る）。

interface RuntimeState {
  uploadedDatasets: GTFSDataset[]
  activeDatasetId: string | null
}

const STATE_FILE = "gtfs-datasets.json"
const embeddedDatasets = embeddedData.datasets as unknown as GTFSDataset[]
const embeddedActiveId = embeddedData.activeDatasetId as string

let memoryState: RuntimeState | null = null

async function loadState(): Promise<RuntimeState> {
  if (!memoryState) {
    memoryState = (await readJsonFile<RuntimeState>(STATE_FILE)) || {
      uploadedDatasets: [],
      activeDatasetId: embeddedActiveId,
    }
  }
  return memoryState
}

async function saveState(state: RuntimeState): Promise<void> {
  memoryState = state
  await writeJsonFile(STATE_FILE, state)
}

function isEmbeddedId(datasetId: string): boolean {
  return embeddedDatasets.some((d) => d.id === datasetId)
}

function getAllDatasets(state: RuntimeState): GTFSDataset[] {
  return [...embeddedDatasets, ...state.uploadedDatasets]
}

function getActiveDataset(state: RuntimeState): GTFSDataset | null {
  const all = getAllDatasets(state)
  return (
    all.find((d) => d.id === state.activeDatasetId) ||
    all.find((d) => d.id === embeddedActiveId) ||
    all[0] ||
    null
  )
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get("action")

  try {
    const state = await loadState()

    switch (action) {
      case "list":
        return NextResponse.json({ datasets: getAllDatasets(state), activeDatasetId: state.activeDatasetId })

      case "active":
        return NextResponse.json({ dataset: getActiveDataset(state) })

      case "get": {
        const datasetId = searchParams.get("id")
        if (!datasetId) {
          return NextResponse.json({ error: "Dataset ID required" }, { status: 400 })
        }
        const dataset = getAllDatasets(state).find((d) => d.id === datasetId)
        return NextResponse.json({ dataset: dataset || null })
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }
  } catch (error) {
    console.error("[gtfs] GTFS API GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, dataset, datasetId } = body

    // 更新系は管理者認証必須
    if (!getRequestSession(request, body)) {
      return NextResponse.json({ error: "管理者認証が必要です" }, { status: 401 })
    }

    const state = await loadState()

    switch (action) {
      case "save": {
        if (!dataset) {
          return NextResponse.json({ error: "Dataset required" }, { status: 400 })
        }
        if (isEmbeddedId(dataset.id)) {
          return NextResponse.json({ error: "同梱データセットは上書きできません" }, { status: 400 })
        }

        const uploadedDatasets = [...state.uploadedDatasets]
        const existingIndex = uploadedDatasets.findIndex((d) => d.id === dataset.id)
        if (existingIndex >= 0) {
          uploadedDatasets[existingIndex] = dataset
        } else {
          uploadedDatasets.push(dataset)
        }

        await saveState({ uploadedDatasets, activeDatasetId: dataset.id })
        console.log("[gtfs] GTFSデータセットを保存:", dataset.name)
        return NextResponse.json({ success: true, message: "Dataset saved successfully" })
      }

      case "setActive": {
        if (!datasetId) {
          return NextResponse.json({ error: "Dataset ID required" }, { status: 400 })
        }
        const exists = getAllDatasets(state).some((d) => d.id === datasetId)
        if (!exists) {
          return NextResponse.json({ error: "Dataset not found" }, { status: 404 })
        }

        await saveState({ ...state, activeDatasetId: datasetId })
        return NextResponse.json({ success: true, message: "Active dataset updated" })
      }

      case "delete": {
        if (!datasetId) {
          return NextResponse.json({ error: "Dataset ID required" }, { status: 400 })
        }
        if (isEmbeddedId(datasetId)) {
          return NextResponse.json(
            { error: "同梱データセットは削除できません（差し替えは scripts/convert-oud2.mjs で再生成してください）" },
            { status: 400 },
          )
        }

        const uploadedDatasets = state.uploadedDatasets.filter((d) => d.id !== datasetId)
        const activeDatasetId = state.activeDatasetId === datasetId ? embeddedActiveId : state.activeDatasetId

        await saveState({ uploadedDatasets, activeDatasetId })
        console.log("[gtfs] GTFSデータセットを削除:", datasetId)
        return NextResponse.json({ success: true, message: "Dataset deleted successfully" })
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }
  } catch (error) {
    console.error("[gtfs] GTFS API POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
