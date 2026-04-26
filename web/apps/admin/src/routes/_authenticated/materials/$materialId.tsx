// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useDocument } from "@modules/lib/firestore"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useDb } from "@modules/lib/firebase-context"
import { catalogRef } from "@modules/lib/firestore-helpers"
import type { PricingModel } from "@modules/lib/firestore-entities"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { Card, CardContent } from "@modules/components/ui/card"
import { Button } from "@modules/components/ui/button"
import { useForm } from "react-hook-form"
import { Loader2, Save } from "lucide-react"
import { useEffect } from "react"
import { CatalogFormFields, type CatalogFormValues } from "@/components/admin/catalog-form-fields"

export const Route = createFileRoute(
  "/_authenticated/materials/$materialId",
)({
  component: CatalogDetailPage,
})

function CatalogDetailPage() {
  const db = useDb()
  const { materialId } = Route.useParams()
  const { data: catalog, loading } = useDocument(catalogRef(db, materialId))
  const { update, loading: saving } = useFirestoreMutation()

  const { register, handleSubmit, reset, control } = useForm<CatalogFormValues>()

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
      catalogRef(db, materialId),
      {
        code: values.code,
        name: values.name,
        description: values.description || null,
        workshops: values.workshops.split(",").map((w) => w.trim()).filter(Boolean),
        // The form keeps `pricingModel` as a free string; the catalog
        // schema narrows it to a union. Trust the form widget's options.
        pricingModel: values.pricingModel as PricingModel,
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
            <CatalogFormFields register={register} control={control} showActive />
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
