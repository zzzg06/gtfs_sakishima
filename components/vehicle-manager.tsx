"use client"
import { useState, useEffect } from "react"
import type React from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Plus, Edit, Trash2, Train, ArrowLeft, Upload, X, FileSpreadsheet, Download } from "lucide-react"
import { vehicleManager, type Vehicle } from "@/lib/vehicle-manager"
import { DEFAULT_ICON_TO_VEHICLE } from "@/lib/dynmap-vehicle-icons"
import { parseVehicleFile, downloadVehicleTemplate } from "@/lib/vehicle-import"

interface VehicleManagerProps {
  onBack: () => void
}

export function VehicleManager({ onBack }: VehicleManagerProps) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null)
  const [formData, setFormData] = useState({
    name: "",
    capacity: "",
    description: "",
    color: "#3b82f6",
    iconUrl: "",
    dynmapIcon: "",
  })
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [importMessage, setImportMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [importWarnings, setImportWarnings] = useState<string[]>([])

  useEffect(() => {
    loadVehicles()
  }, [])

  const loadVehicles = async () => {
    const loadedVehicles = await vehicleManager.loadVehicles()
    setVehicles(Array.isArray(loadedVehicles) ? loadedVehicles : [])
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert("画像ファイルは5MB以下にしてください")
        return
      }

      setSelectedImage(file)
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        setImagePreview(result)
        setFormData({ ...formData, iconUrl: result })
      }
      reader.readAsDataURL(file)
    }
  }

  const handleImageRemove = () => {
    setSelectedImage(null)
    setImagePreview(null)
    setFormData({ ...formData, iconUrl: "" })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const vehicleData = {
      name: formData.name.trim(),
      capacity: formData.capacity ? Number.parseInt(formData.capacity) : undefined,
      description: formData.description.trim() || undefined,
      color: formData.color,
      iconUrl: formData.iconUrl || undefined,
      dynmapIcon: formData.dynmapIcon.trim() || undefined,
    }

    if (!vehicleData.name) {
      alert("車両名は必須です")
      return
    }

    try {
      if (editingVehicle) {
        await vehicleManager.updateVehicle(editingVehicle.id, vehicleData)
      } else {
        await vehicleManager.addVehicle(vehicleData)
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "車両の保存に失敗しました")
      return
    }

    resetForm()
    await loadVehicles()
  }

  const handleBulkImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // 同じファイルを再選択できるようにリセット
    if (!file) return

    setIsImporting(true)
    setImportMessage(null)
    setImportWarnings([])

    try {
      const { vehicles: parsedVehicles, errors } = await parseVehicleFile(file)
      setImportWarnings(errors)

      if (parsedVehicles.length === 0) {
        setImportMessage({ type: "error", text: "取り込める車両がありませんでした" })
        return
      }

      const added = await vehicleManager.addVehicles(parsedVehicles)
      setImportMessage({ type: "success", text: `${added.length}台の車両を追加しました` })
      await loadVehicles()
    } catch (error) {
      setImportMessage({
        type: "error",
        text: error instanceof Error ? error.message : "ファイルの読み込みに失敗しました",
      })
    } finally {
      setIsImporting(false)
    }
  }

  const handleEdit = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle)
    setFormData({
      name: vehicle.name,
      capacity: vehicle.capacity?.toString() || "",
      description: vehicle.description || "",
      color: vehicle.color || "#3b82f6",
      iconUrl: vehicle.iconUrl || "",
      dynmapIcon: vehicle.dynmapIcon || "",
    })
    if (vehicle.iconUrl) {
      setImagePreview(vehicle.iconUrl)
    }
    setIsEditing(true)
  }

  const handleDelete = async (vehicleId: string) => {
    if (confirm("この車両を削除しますか？関連する運用との関連付けも削除されます。")) {
      try {
        await vehicleManager.deleteVehicle(vehicleId)
      } catch (error) {
        alert(error instanceof Error ? error.message : "車両の削除に失敗しました")
      }
      await loadVehicles()
    }
  }

  const resetForm = () => {
    setFormData({
      name: "",
      capacity: "",
      description: "",
      color: "#3b82f6",
      iconUrl: "",
      dynmapIcon: "",
    })
    setEditingVehicle(null)
    setIsEditing(false)
    setSelectedImage(null)
    setImagePreview(null)
  }

  const getVehicleIcon = (vehicle: Vehicle) => {
    if (vehicle.iconUrl) {
      return (
        <img
          src={vehicle.iconUrl || "/placeholder.svg"}
          alt={vehicle.name}
          className="h-6 w-6 object-contain rounded"
        />
      )
    }

    // 画像未設定のときの既定アイコン（車両タイプは廃止）
    return <Train className="h-4 w-4" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          戻る
        </Button>
        <h2 className="text-xl font-semibold">車両管理</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            {editingVehicle ? "車両編集" : "車両追加"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">車両名 *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例：1001号車"
                  required
                />
              </div>
              <div>
                <Label htmlFor="dynmapIcon">Dynmapアイコン名</Label>
                <Input
                  id="dynmapIcon"
                  value={formData.dynmapIcon}
                  onChange={(e) => setFormData({ ...formData, dynmapIcon: e.target.value })}
                  placeholder="例：kr3000_32（実位置でこの車両として表示）"
                  list="dynmap-icon-suggestions"
                />
                <datalist id="dynmap-icon-suggestions">
                  {Object.keys(DEFAULT_ICON_TO_VEHICLE).map((icon) => (
                    <option key={icon} value={icon} />
                  ))}
                </datalist>
                <p className="mt-1 text-xs text-muted-foreground">
                  Dynmapのマーカーがこのアイコンなら、走行位置でこの車両として表示します（空欄なら車両名で自動判定）。
                </p>
              </div>
              <div>
                <Label htmlFor="capacity">定員</Label>
                <Input
                  id="capacity"
                  type="number"
                  value={formData.capacity}
                  onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
                  placeholder="例：150"
                />
              </div>
              <div>
                <Label htmlFor="color">表示色</Label>
                <Input
                  id="color"
                  type="color"
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="icon">車両アイコン画像</Label>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input id="icon" type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
                  <Button type="button" variant="outline" onClick={() => document.getElementById("icon")?.click()}>
                    <Upload className="h-4 w-4 mr-2" />
                    画像を選択
                  </Button>
                  {imagePreview && (
                    <Button type="button" variant="outline" size="sm" onClick={handleImageRemove}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {imagePreview && (
                  <div className="flex items-center gap-2">
                    <img
                      src={imagePreview || "/placeholder.svg"}
                      alt="プレビュー"
                      className="h-12 w-12 object-contain border rounded"
                    />
                    <span className="text-sm text-muted-foreground">
                      プレビュー（推奨サイズ: 64x64px以下、5MB以下）
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="description">説明</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="車両の詳細情報"
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit">{editingVehicle ? "更新" : "追加"}</Button>
              {editingVehicle && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  キャンセル
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Excel/CSV一括インポート
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Excel（.xlsx）またはCSVファイルから車両をまとめて追加できます。 1行目はヘッダー（
            <span className="font-mono text-xs">車両名 / 定員 / 説明 / 表示色 / アイコンURL</span>
            ）、車両名だけ必須です。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="bulk-import"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleBulkImport}
              className="hidden"
            />
            <Button
              type="button"
              onClick={() => document.getElementById("bulk-import")?.click()}
              disabled={isImporting}
            >
              <Upload className="h-4 w-4 mr-2" />
              {isImporting ? "取り込み中..." : "ファイルを選択して取り込み"}
            </Button>
            <Button type="button" variant="outline" onClick={() => downloadVehicleTemplate()}>
              <Download className="h-4 w-4 mr-2" />
              テンプレートをダウンロード
            </Button>
          </div>
          {importMessage && (
            <Alert variant={importMessage.type === "error" ? "destructive" : "default"}>
              <AlertDescription>{importMessage.text}</AlertDescription>
            </Alert>
          )}
          {importWarnings.length > 0 && (
            <Alert>
              <AlertDescription>
                <ul className="list-disc pl-4 space-y-1">
                  {importWarnings.map((warning, i) => (
                    <li key={i} className="text-sm">
                      {warning}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>登録済み車両 ({vehicles.length}台)</CardTitle>
        </CardHeader>
        <CardContent>
          {vehicles.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">車両が登録されていません</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.isArray(vehicles) &&
                vehicles.map((vehicle) => (
                  <Card key={vehicle.id} className="border-2" style={{ borderColor: vehicle.color }}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getVehicleIcon(vehicle)}
                          <h3 className="font-medium">{vehicle.name}</h3>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => handleEdit(vehicle)}>
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleDelete(vehicle.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      {vehicle.capacity && <p className="text-sm text-muted-foreground">定員: {vehicle.capacity}人</p>}
                      {vehicle.description && (
                        <p className="text-sm text-muted-foreground mt-1">{vehicle.description}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
