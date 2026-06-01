// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useDocument } from "@modules/lib/firestore"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { catalogRef } from "@modules/lib/firestore-helpers"
import type { PricingModel } from "@modules/lib/firestore-entities"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { Card, CardContent } from "@modules/components/ui/card"
import { Button } from "@modules/components/ui/button"
import { useForm } from "react-hook-form"
import { Loader2, Printer, Save } from "lucide-react"
import { useEffect } from "react"
import { rpcCallable } from "@modules/lib/rpc"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { useBridge } from "@modules/lib/use-bridge"
import { buildRasterJob } from "@oww/shared"
import { useLabelBitmap } from "@/printer/use-label-bitmap"
import { LabelPreview } from "@/printer/label-preview"
import { CatalogFormFields, type CatalogFormValues } from "@/components/admin/catalog-form-fields"

export const Route = createFileRoute(
  "/_authenticated/materials/$materialId",
)({
  component: CatalogDetailPage,
})

function CatalogDetailPage() {
  const db = useDb()
  const functions = useFunctions()
  const { materialId } = Route.useParams()
  const { data: catalog, loading } = useDocument(catalogRef(db, materialId))
  // Catalog writes flow through upsertCatalogItem; client-side Firestore
  // writes to catalog are denied by rules so the `code` uniqueness
  // invariant can be enforced server-side. See ADR-0026.
  const save = useAsyncMutation({
    context: "admin.upsertCatalogItem",
    successMessage: "Katalogeintrag gespeichert",
    errorMessage: "Katalogeintrag konnte nicht gespeichert werden",
  })
  const saving = save.loading

  const bridge = useBridge()
  const canPrint = bridge.features.includes("print")
  const print = useAsyncMutation({
    context: "admin.printLabel",
    successMessage: "Etikett gedruckt",
    errorMessage: "Etikett konnte nicht gedruckt werden",
  })

  const { register, handleSubmit, reset, control } = useForm<CatalogFormValues>()

  useEffect(() => {
    if (catalog) {
      // The form is single-variant-aware only — multi-variant editing is
      // out of scope for this admin route until the picker/UI work in PR C
      // lands. Read from variants[0]; saving below overwrites the whole
      // variants array.
      const primary = catalog.variants?.[0]
      reset({
        code: catalog.code,
        name: catalog.name,
        description: catalog.description ?? "",
        workshops: catalog.workshops?.join(", ") ?? "",
        pricingModel: primary?.pricingModel ?? "direct",
        priceNone: String(primary?.unitPrice?.default ?? 0),
        priceMember: String(
          typeof primary?.unitPrice?.member === "number"
            ? primary.unitPrice.member
            : primary?.unitPrice?.default ?? 0,
        ),
        active: catalog.active,
        userCanAdd: catalog.userCanAdd,
      })
    }
  }, [catalog, reset])

  const checkoutDomain = import.meta.env.VITE_CHECKOUT_DOMAIN
  const labelInput =
    canPrint && catalog && checkoutDomain
      ? {
          url: `${checkoutDomain}/visit/add/item/${catalog.code}`,
          title: catalog.name,
          code: `#${catalog.code}`,
          tape: "18mm" as const,
        }
      : null
  const { bitmap: previewBitmap, loading: rendering } = useLabelBitmap(
    labelInput,
    canPrint,
  )

  if (loading) return <PageLoading />
  if (!catalog) return <div>Katalogeintrag nicht gefunden.</div>

  const onPrint = async () => {
    if (!previewBitmap) return
    try {
      await print.mutate(async () => {
        const bytes = buildRasterJob(previewBitmap, { tape: "18mm" })
        await bridge.print(bytes)
      })
    } catch {
      // useAsyncMutation already toasted + logged.
    }
  }

  const onSubmit = async (values: CatalogFormValues) => {
    // Preserve any extra variants on the doc (the admin form edits only
    // variants[0] today). PR C will introduce a multi-variant editor.
    const existingVariants = catalog?.variants ?? []
    const defaultPrice = parseFloat(values.priceNone) || 0
    const memberPrice = parseFloat(values.priceMember) || 0
    const updatedPrimary = {
      id: existingVariants[0]?.id ?? "default",
      // Preserve any meaningful label on the existing primary; admin form
      // doesn't edit labels yet (multi-variant editor is a PR C followup).
      ...(existingVariants[0]?.label
        ? { label: existingVariants[0].label }
        : {}),
      pricingModel: values.pricingModel as PricingModel,
      unitPrice:
        memberPrice !== defaultPrice
          ? { default: defaultPrice, member: memberPrice }
          : { default: defaultPrice },
    }
    const nextVariants = [updatedPrimary, ...existingVariants.slice(1)]
    try {
      await save.mutate(async () => {
        const fn = rpcCallable<
          {
            id: string
            code: string
            name: string
            description: string | null
            workshops: string[]
            variants: typeof nextVariants
            active: boolean
            userCanAdd: boolean
          },
          { id: string }
        >(functions, "catalogCall", "upsertCatalogItem")
        await fn({
          id: materialId,
          code: values.code,
          name: values.name,
          description: values.description || null,
          workshops: values.workshops
            .split(",")
            .map((w) => w.trim())
            .filter(Boolean),
          variants: nextVariants,
          active: values.active,
          userCanAdd: values.userCanAdd,
        })
      })
    } catch {
      // Hook surfaced the toast + telemetry; stay on the page so the
      // user can adjust and retry.
    }
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
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Speichern
              </Button>
              {canPrint && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onPrint}
                    disabled={print.loading || !previewBitmap}
                  >
                    {print.loading ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Printer className="h-4 w-4 mr-2" />
                    )}
                    Etikett drucken
                  </Button>
                  <LabelPreview bitmap={previewBitmap} loading={rendering} />
                </>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
