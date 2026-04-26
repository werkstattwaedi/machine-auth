// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useDocument, useCollection } from "@modules/lib/firestore"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { httpsCallable } from "firebase/functions"
import {
  catalogCollection,
  priceListRef,
} from "@modules/lib/firestore-helpers"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@modules/components/ui/card"
import { Button } from "@modules/components/ui/button"
import { Input } from "@modules/components/ui/input"
import { Label } from "@modules/components/ui/label"
import { Checkbox } from "@modules/components/ui/checkbox"
import { Switch } from "@modules/components/ui/switch"
import { useForm } from "react-hook-form"
import { Loader2, Save, Download } from "lucide-react"
import { useEffect, useState, useCallback } from "react"
import { toast } from "sonner"
import { formatCHF } from "@modules/lib/format"

export const Route = createFileRoute(
  "/_authenticated/price-lists/$priceListId",
)({
  component: PriceListDetailPage,
})

interface FormValues {
  name: string
  footer: string
  active: boolean
}

function PriceListDetailPage() {
  const db = useDb()
  const { priceListId } = Route.useParams()
  const { data: priceList, loading } = useDocument(
    priceListRef(db, priceListId),
  )
  const { data: allCatalog, loading: catalogLoading } =
    useCollection(catalogCollection(db))
  const { update, loading: saving } = useFirestoreMutation()
  const functions = useFunctions()
  const [downloading, setDownloading] = useState(false)

  const { register, handleSubmit, reset, setValue, watch } =
    useForm<FormValues>()
  const [selectedItems, setSelectedItems] = useState<string[]>([])

  const active = watch("active")

  useEffect(() => {
    if (priceList) {
      reset({
        name: priceList.name,
        footer: priceList.footer,
        active: priceList.active,
      })
      setSelectedItems(priceList.items ?? [])
    }
  }, [priceList, reset])

  const onSubmit = async (values: FormValues) => {
    await update(
      priceListRef(db, priceListId),
      {
        name: values.name,
        footer: values.footer,
        active: values.active,
        items: selectedItems,
      },
      {
        successMessage: "Preisliste gespeichert",
      },
    )
  }

  const toggleItem = useCallback((itemId: string) => {
    setSelectedItems((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId],
    )
  }, [])

  const handleDownloadPdf = async () => {
    if (!priceList) return
    setDownloading(true)
    try {
      const fn = httpsCallable<{ priceListId: string }, { url: string }>(
        functions,
        "getPriceListPdfUrl",
      )
      const result = await fn({ priceListId })
      // Mirror the bill-download pattern (web/apps/checkout/src/routes/
      // _authenticated/usage.tsx): synthesise an anchor click rather than
      // window.open, so the post-await popup blocker doesn't trip.
      const a = document.createElement("a")
      a.href = result.data.url
      a.rel = "noopener"
      a.target = "_self"
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "PDF konnte nicht erstellt werden."
      toast.error(message)
    } finally {
      setDownloading(false)
    }
  }

  if (loading || catalogLoading) return <PageLoading />
  if (!priceList) return <div>Preisliste nicht gefunden.</div>

  const qrUrl = `https://${import.meta.env.VITE_CHECKOUT_DOMAIN}/material/add?priceList=${priceListId}`

  // Sort catalog by code for the picker
  const sortedCatalog = [...allCatalog].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true }),
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={priceList.name || "Preisliste"}
        backTo="/price-lists"
        backLabel="Zurück zu Preislisten"
      />

      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4 max-w-lg"
          >
            <div className="space-y-1">
              <Label>Name</Label>
              <Input {...register("name", { required: true })} />
            </div>
            <div className="space-y-1">
              <Label>Fusszeile</Label>
              <Input {...register("footer")} />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={active}
                onCheckedChange={(checked) => setValue("active", checked)}
              />
              <Label>Aktiv</Label>
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
          <CardTitle className="text-base">
            Katalogeinträge ({selectedItems.length} ausgewählt)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {sortedCatalog.map((item) => (
              <label
                key={item.id}
                className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={selectedItems.includes(item.id)}
                  onCheckedChange={() => toggleItem(item.id)}
                />
                <span className="font-mono text-xs w-12">{item.code}</span>
                <span className="flex-1 text-sm">{item.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatCHF(item.unitPrice?.none ?? 0)}
                </span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">PDF herunterladen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            QR-Code verweist auf: {qrUrl}
          </p>
          <Button
            onClick={handleDownloadPdf}
            disabled={selectedItems.length === 0 || downloading}
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            PDF herunterladen
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
