"use client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Clock, Calendar } from "lucide-react"

export type SearchType = "departure" | "arrival"

interface TimeSelectorProps {
  searchType: SearchType
  selectedTime: string
  onSearchTypeChange: (type: SearchType) => void
  onTimeChange: (time: string) => void
  onSearch: () => void
  canSearch: boolean
}

export function TimeSelector({
  searchType,
  selectedTime,
  onSearchTypeChange,
  onTimeChange,
  onSearch,
  canSearch,
}: TimeSelectorProps) {
  const generateHourOptions = () => {
    const hours: string[] = []
    for (let hour = 5; hour < 24; hour++) {
      hours.push(hour.toString().padStart(2, "0"))
    }
    return hours
  }

  const generateMinuteOptions = () => {
    const minutes: string[] = []
    for (let minute = 0; minute < 60; minute++) {
      minutes.push(minute.toString().padStart(2, "0"))
    }
    return minutes
  }

  const hourOptions = generateHourOptions()
  const minuteOptions = generateMinuteOptions()

  // Get current time as default
  const getCurrentTime = () => {
    const now = new Date()
    const hour = now.getHours()
    const minute = now.getMinutes()
    return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`
  }

  // Set current time as default if no time is selected
  const defaultTime = selectedTime || getCurrentTime()
  const [defaultHour, defaultMinute] = defaultTime.split(":")

  const handleHourChange = (hour: string) => {
    const currentMinute = selectedTime ? selectedTime.split(":")[1] : defaultMinute
    onTimeChange(`${hour}:${currentMinute}`)
  }

  const handleMinuteChange = (minute: string) => {
    const currentHour = selectedTime ? selectedTime.split(":")[0] : defaultHour
    onTimeChange(`${currentHour}:${minute}`)
  }

  const currentHour = selectedTime ? selectedTime.split(":")[0] : defaultHour
  const currentMinute = selectedTime ? selectedTime.split(":")[1] : defaultMinute

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Clock className="h-5 w-5" />
          時刻選択
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Search Type Selection */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-foreground">検索条件</label>
          <div className="flex gap-2">
            <Button
              variant={searchType === "departure" ? "default" : "outline"}
              onClick={() => onSearchTypeChange("departure")}
              className="flex-1"
            >
              <Calendar className="h-4 w-4 mr-2" />
              出発時刻指定
            </Button>
            <Button
              variant={searchType === "arrival" ? "default" : "outline"}
              onClick={() => onSearchTypeChange("arrival")}
              className="flex-1"
            >
              <Calendar className="h-4 w-4 mr-2" />
              到着時刻指定
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-foreground">
            {searchType === "departure" ? "出発時刻" : "到着時刻"}
          </label>
          <div className="flex gap-2 items-center">
            {/* Hour Selection */}
            <div className="flex-1">
              <Select value={currentHour} onValueChange={handleHourChange}>
                <SelectTrigger className="w-full bg-input border-border focus:ring-ring">
                  <SelectValue placeholder="時間" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {hourOptions.map((hour) => (
                    <SelectItem key={hour} value={hour} className="hover:bg-accent hover:text-accent-foreground">
                      {hour}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <span className="text-lg font-medium">:</span>

            {/* Minute Selection */}
            <div className="flex-1">
              <Select value={currentMinute} onValueChange={handleMinuteChange}>
                <SelectTrigger className="w-full bg-input border-border focus:ring-ring">
                  <SelectValue placeholder="分" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {minuteOptions.map((minute) => (
                    <SelectItem key={minute} value={minute} className="hover:bg-accent hover:text-accent-foreground">
                      {minute}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Search Button */}
        <Button
          onClick={onSearch}
          disabled={!canSearch}
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          size="lg"
        >
          <Clock className="h-4 w-4 mr-2" />
          経路を検索
        </Button>

        {!canSearch && (
          <p className="text-sm text-muted-foreground text-center">出発駅と到着駅を選択してから検索してください</p>
        )}
      </CardContent>
    </Card>
  )
}
