// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useDocument } from "@/lib/firestore"
import { useFirestoreMutation } from "@/hooks/use-firestore-mutation"
import { PageLoading } from "@/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useForm } from "react-hook-form"
import { Loader2, Save, QrCode } from "lucide-react"
import { useEffect, useState } from "react"
import { QRCodeSVG } from "qrcode.react"

export const Route = createFileRoute(
  "/_authenticated/_admin/materials/$materialId",
)({
  component: MaterialDetailPage,
})

interface MaterialDoc {
  name: string
  description?: string | null
  workshop: string
  category: string
  unitPrice: number
  unit: string
  active: boolean
  shortlistGroup?: string | null
}

interface MaterialFormValues {
  name: string
  description: string
  workshop: string
  category: string
  unitPrice: string
  unit: string
  active: boolean
  shortlistGroup: string
}

function MaterialDetailPage() {
  const { materialId } = Route.useParams()
  const { data: material, loading } = useDocument<MaterialDoc>(
    `materials/${materialId}`,
  )
  const { update, loading: saving } = useFirestoreMutation()
  const [showQr, setShowQr] = useState(false)

  const { register, handleSubmit, reset } = useForm<MaterialFormValues>()

  useEffect(() => {
    if (material) {
      reset({
        name: material.name,
        description: material.description ?? "",
        workshop: material.workshop,
        category: material.category,
        unitPrice: String(material.unitPrice),
        unit: material.unit,
        active: material.active,
        shortlistGroup: material.shortlistGroup ?? "",
      })
    }
  }, [material, reset])

  if (loading) return <PageLoading />
  if (!material) return <div>Material nicht gefunden.</div>

  const onSubmit = async (values: MaterialFormValues) => {
    await update(
      "materials",
      materialId,
      {
        name: values.name,
        description: values.description || null,
        workshop: values.workshop,
        category: values.category,
        unitPrice: parseFloat(values.unitPrice) || 0,
        unit: values.unit,
        active: values.active,
        shortlistGroup: values.shortlistGroup || null,
      },
      {
        successMessage: "Material gespeichert",
      },
    )
  }

  const qrUrl = `${window.location.origin}/material/add?id=${materialId}`
  const groupQrUrl = material.shortlistGroup
    ? `${window.location.origin}/material/add?group=${material.shortlistGroup}`
    : null

  return (
    <div className="space-y-4">
      <PageHeader
        title={material.name || "Material"}
        backTo="/materials"
        backLabel="Zurück zu Materialien"
      />

      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4 max-w-lg"
          >
            <div className="space-y-2">
              <Label>Name</Label>
              <Input {...register("name")} />
            </div>
            <div className="space-y-2">
              <Label>Beschreibung</Label>
              <Input {...register("description")} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Werkstatt</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  {...register("workshop")}
                >
                  <option value="holz">Holz</option>
                  <option value="metall">Metall</option>
                  <option value="textil">Textil</option>
                  <option value="elektronik">Elektronik</option>
                  <option value="allgemein">Allgemein</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Kategorie</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  {...register("category")}
                >
                  <option value="m2">m²</option>
                  <option value="m">m</option>
                  <option value="stk">Stk.</option>
                  <option value="chf">CHF</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Preis pro Einheit (CHF)</Label>
                <Input type="number" step="0.01" {...register("unitPrice")} />
              </div>
              <div className="space-y-2">
                <Label>Einheit (Anzeige)</Label>
                <Input {...register("unit")} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Shortlist-Gruppe</Label>
              <Input
                placeholder="z.B. sperrholz"
                {...register("shortlistGroup")}
              />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="active" {...register("active")} />
              <Label htmlFor="active">Aktiv</Label>
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Speichern
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">QR-Codes</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowQr(!showQr)}
            >
              <QrCode className="h-4 w-4 mr-2" />
              {showQr ? "Ausblenden" : "Anzeigen"}
            </Button>
          </div>
        </CardHeader>
        {showQr && (
          <CardContent>
            <div className="flex gap-8">
              <div className="text-center">
                <p className="text-sm font-medium mb-2">Einzelnes Material</p>
                <QRCodeSVG value={qrUrl} size={160} />
                <p className="text-xs text-muted-foreground mt-1 break-all max-w-[160px]">
                  {qrUrl}
                </p>
              </div>
              {groupQrUrl && (
                <div className="text-center">
                  <p className="text-sm font-medium mb-2">
                    Shortlist: {material.shortlistGroup}
                  </p>
                  <QRCodeSVG value={groupQrUrl} size={160} />
                  <p className="text-xs text-muted-foreground mt-1 break-all max-w-[160px]">
                    {groupQrUrl}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
