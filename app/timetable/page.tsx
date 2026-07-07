import type { Metadata } from "next"
import { TimetableIndex } from "./timetable-index"

export const metadata: Metadata = { title: "時刻表" }

export default function TimetableIndexPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <TimetableIndex />
      </div>
    </main>
  )
}
