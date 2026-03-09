// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useDocument } from "@/lib/firestore"
import { useFirestoreMutation } from "@/hooks/use-firestore-mutation"
import { PageLoading } from "@/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useForm } from "react-hook-form"
import { Loader2, Save } from "lucide-react"
import { useEffect } from "react"

export const Route = createFileRoute(
  "/_authenticated/_admin/materials/$materialId",
)({
  component: CatalogDetailPage,
})

interface CatalogDoc {
  code: string
  name: string
  workshops: string[]
  pricingModel: string
  unitPrice: { none: number; member: number; intern: number }
  active: boolean
  userCanAdd: boolean
  description?: string | null
}

interface CatalogFormValues {
  code: string
  name: string
  description: string
  workshops: string
  pricingModel: string
  priceNone: string
  priceMember: string
  priceIntern: string
  active: boolean
  userCanAdd: boolean
}

function CatalogDetailPage() {
  const { materialId } = Route.useParams()
  const { data: catalog, loading } = useDocument<CatalogDoc>(
    `catalog/${materialId}`,
  )
  const { update, loading: saving } = useFirestoreMutation()

  const { register, handleSubmit, reset } = useForm<CatalogFormValues>()

  useEffect(() => {
    if (catalog) {
      reset({
        code: catalog.code,
        name: catalog.name,
        description: catalog.description ?? "",
        workshops: catalog.workshops?.join(", ") ?? "",
        pricingModel: catalog.pricingModel,
        priceNone: String(catalog.unitPrice?.none ?? 0),
        priceMember: String(catalog.unitPrice?.member ?? 0),
        priceIntern: String(catalog.unitPrice?.intern ?? 0),
        active: catalog.active,
        userCanAdd: catalog.userCanAdd,
      })
    }
  }, [catalog, reset])

  if (loading) return <PageLoading />
  if (!catalog) return <div>Katalogeintrag nicht gefunden.</div>

  const onSubmit = async (values: CatalogFormValues) => {
    await update(
      "catalog",
      materialId,
      {
        code: values.code,
        name: values.name,
        description: values.description || null,
        workshops: values.workshops.split(",").map((w) => w.trim()).filter(Boolean),
        pricingModel: values.pricingModel,
        unitPrice: {
          none: parseFloat(values.priceNone) || 0,
          member: parseFloat(values.priceMember) || 0,
          intern: parseFloat(values.priceIntern) || 0,
        },
        active: values.active,
        userCanAdd: values.userCanAdd,
      },
      {
        successMessage: "Katalogeintrag gespeichert",
      },
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={catalog.name || "Katalogeintrag"}
        backTo="/materials"
        backLabel="Zurück zum Katalog"
      />

      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4 max-w-lg"
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Code</Label>
                <Input {...register("code")} />
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input {...register("name")} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Beschreibung</Label>
              <Input {...register("description")} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Werkstätten (kommagetrennt)</Label>
                <Input {...register("workshops")} />
              </div>
              <div className="space-y-2">
                <Label>Preismodell</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  {...register("pricingModel")}
                >
                  <option value="time">Zeit (Std.)</option>
                  <option value="area">Fläche (m²)</option>
                  <option value="length">Länge (m)</option>
                  <option value="count">Stück</option>
                  <option value="weight">Gewicht (kg)</option>
                  <option value="direct">Betrag (CHF)</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Preis (Voll)</Label>
                <Input type="number" step="0.01" {...register("priceNone")} />
              </div>
              <div className="space-y-2">
                <Label>Preis (Mitglied)</Label>
                <Input type="number" step="0.01" {...register("priceMember")} />
              </div>
              <div className="space-y-2">
                <Label>Preis (Intern)</Label>
                <Input type="number" step="0.01" {...register("priceIntern")} />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="active" {...register("active")} />
                <Label htmlFor="active">Aktiv</Label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="userCanAdd" {...register("userCanAdd")} />
                <Label htmlFor="userCanAdd">Benutzer kann hinzufügen</Label>
              </div>
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
    </div>
  )
}
