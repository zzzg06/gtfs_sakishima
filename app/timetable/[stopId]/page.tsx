import type { Metadata } from "next"
import { TimetableView } from "./timetable-view"

// stop_id は当データでは駅/停留所の表示名と一致するため、そのままタイトルに使える。
export async function generateMetadata({
  params,
}: {
  params: Promise<{ stopId: string }>
}): Promise<Metadata> {
  const { stopId } = await params
  const name = decodeURIComponent(stopId || "")
  return { title: name ? `${name} 時刻表` : "時刻表" }
}

export default function TimetablePage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <TimetableView />
      </div>
    </main>
  )
}
