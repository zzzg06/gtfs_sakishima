"use client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Bus, MapPin, EyeOff, Car } from "lucide-react"
import type { TransportOptions as RouteFinderTransportOptions } from "@/lib/route-finder"

interface TransportOptionsProps {
  options: RouteFinderTransportOptions
  onOptionsChange: (options: RouteFinderTransportOptions) => void
}

export function TransportOptions({ options, onOptionsChange }: TransportOptionsProps) {
  const handleWalkingChange = (checked: boolean) => {
    onOptionsChange({
      ...options,
      allowWalking: checked,
    })
  }

  const handleBusChange = (checked: boolean) => {
    onOptionsChange({
      ...options,
      allowBus: checked,
    })
  }

  const handleBusPreferChange = (checked: boolean) => {
    onOptionsChange({
      ...options,
      preferBus: checked,
    })
  }

  const handleShowExcludedTripsChange = (checked: boolean) => {
    onOptionsChange({
      ...options,
      showExcludedTrips: checked,
    })
  }

  const handleTaxiChange = (checked: boolean) => {
    onOptionsChange({
      ...options,
      allowTaxi: checked,
    })
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">交通手段</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center space-x-2">
          <Checkbox id="allow-walking" checked={options.allowWalking} onCheckedChange={handleWalkingChange} />
          <Label htmlFor="allow-walking" className="flex items-center gap-2 text-sm cursor-pointer">
            <MapPin className="h-4 w-4 text-blue-600" />
            徒歩を利用する
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox id="allow-bus" checked={options.allowBus} onCheckedChange={handleBusChange} />
          <Label htmlFor="allow-bus" className="flex items-center gap-2 text-sm cursor-pointer">
            <Bus className="h-4 w-4 text-green-600" />
            バスを利用する
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="prefer-bus"
            checked={options.preferBus || false}
            onCheckedChange={handleBusPreferChange}
            disabled={!options.allowBus}
          />
          <Label htmlFor="prefer-bus" className="flex items-center gap-2 text-sm cursor-pointer">
            <Bus className="h-4 w-4 text-orange-600" />
            バスを優先して検索
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="show-excluded-trips"
            checked={options.showExcludedTrips || false}
            onCheckedChange={handleShowExcludedTripsChange}
          />
          <Label htmlFor="show-excluded-trips" className="flex items-center gap-2 text-sm cursor-pointer">
            <EyeOff className="h-4 w-4 text-gray-600" />
            運休中の運用も表示する
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox id="allow-taxi" checked={options.allowTaxi || false} onCheckedChange={handleTaxiChange} />
          <Label htmlFor="allow-taxi" className="flex items-center gap-2 text-sm cursor-pointer">
            <Car className="h-4 w-4 text-yellow-600" />
            タクシーを利用する
          </Label>
        </div>
      </CardContent>
    </Card>
  )
}
