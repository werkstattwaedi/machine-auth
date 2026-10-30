// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useDocument } from "@modules/lib/firestore"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { catalogRef } from "@modules/lib/firestore-helpers"
import type { CatalogVariant, PricingModel } from "@modules/lib/firestore-entities"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { Card, CardContent } from "@modules/components/ui/card"
import { Button } from "@modules/components/ui/button"
import { useForm } from "react-hook-form"
import { Loader2, Printer, Save } from "lucide-react"
import { useEffect, useState } from "react"
import { rpcCallable } from "@modules/lib/rpc"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { useAuth } from "@modules/lib/auth"
import { buildRasterJob } from "@oww/shared"
import { useLabelBitmap } from "@/printer/use-label-bitmap"
import { enqueuePrintJob } from "@/printer/enqueue-print-job"
import { materialLabelInput } from "@/printer/material-label-input"
import { LabelVariantSelect } from "@/printer/label-variant-select"
import { LabelPreview } from "@/printer/label-preview"
import {
  DEFAULT_LABEL_FORMAT,
  LABEL_FORMAT_OPTIONS,
  LABEL_FORMATS,
} from "@/printer/label-formats"
import { FilterPills } from "@/components/admin/filter-pills"
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

  const { user } = useAuth()
  // No static errorMessage: the gateway returns user-ready German printer
  // errors ("Deckel offen", "Kein Band eingelegt", connect timeout …) as the
  // thrown message, so we let useAsyncMutation surface those (it falls back to
  // `Fehler: <message>` for the "unknown" code) instead of a generic string.
  const print = useAsyncMutation({
    context: "admin.printLabel",
    successMessage: "Etikett gedruckt",
  })

  const { register, handleSubmit, reset, control } = useForm<CatalogFormValues>()

  useEffect(() => {
    if (catalog) {
      // The form edits only the base variant (variants[0]); any cut-to-size
      // options (variants[1..]) are import-managed and preserved on save.
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
  // Printing is now always available to admins from any browser — the label
  // is rendered client-side and the job is dispatched to the on-LAN gateway
  // via Firestore. The only requirement is a configured checkout domain for
  // the QR deep link.
  const canPrint = Boolean(checkoutDomain)
  const [formatId, setFormatId] = useState(DEFAULT_LABEL_FORMAT)
  const format = LABEL_FORMATS[formatId]
  const [variantId, setVariantId] = useState<string>()
  const labelInput =
    canPrint && catalog
      ? materialLabelInput(checkoutDomain, catalog, format, variantId)
      : null
  const { bitmap: previewBitmap, loading: rendering } = useLabelBitmap(
    labelInput,
    canPrint,
  )

  if (loading) return <PageLoading />
  if (!catalog) return <div>Katalogeintrag nicht gefunden.</div>

  const onPrint = async () => {
    if (!previewBitmap || !user) return
    try {
      await print.mutate(async () => {
        const bytes = buildRasterJob(previewBitmap, {
          tape: format.tape,
          verticalOffsetDots: format.verticalOffsetDots,
        })
        await enqueuePrintJob(db, { bytes, tape: format.tape, uid: user.uid })
      })
    } catch {
      // useAsyncMutation already toasted + logged.
    }
  }

  const onSubmit = async (values: CatalogFormValues) => {
    // The form edits only the base variant. Any cut-to-size options
    // (variants[1..]) are import-managed, so preserve them verbatim.
    const existingBase = catalog?.variants?.[0]
    const extraVariants = catalog?.variants?.slice(1) ?? []
    const defaultPrice = parseFloat(values.priceNone) || 0
    const memberPrice = parseFloat(values.priceMember) || 0
    const base = {
      id: existingBase?.id ?? "default",
      // Preserve any meaningful label on the existing base variant; the form
      // doesn't edit labels.
      ...(existingBase?.label ? { label: existingBase.label } : {}),
      pricingModel: values.pricingModel as PricingModel,
      unitPrice:
        memberPrice !== defaultPrice
          ? { default: defaultPrice, member: memberPrice }
          : { default: defaultPrice },
    }
    try {
      await save.mutate(async () => {
        const fn = rpcCallable<
          {
            id: string
            code: string
            name: string
            description: string | null
            workshops: string[]
            variants: CatalogVariant[]
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
          variants: [base, ...extraVariants],
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
            {canPrint && (
              <div className="flex flex-wrap items-center gap-2">
                <FilterPills
                  options={LABEL_FORMAT_OPTIONS}
                  value={formatId}
                  onChange={setFormatId}
                />
                <LabelVariantSelect
                  item={catalog}
                  value={variantId}
                  onChange={setVariantId}
                />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
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
                    // While a re-render runs, the bitmap is the previous choice:
                    // the wrong variant, or a tape height buildRasterJob rejects.
                    disabled={print.loading || rendering || !previewBitmap}
                  >
                    {print.loading ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Printer className="h-4 w-4 mr-2" />
                    )}
                    Etikett drucken
                  </Button>
                  <LabelPreview
                    bitmap={previewBitmap}
                    loading={rendering}
                    displayHeight={72 * format.previewScale}
                  />
                </>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
