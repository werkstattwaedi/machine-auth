// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useDocument, useCollection } from "@modules/lib/firestore"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"
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
import { serverTimestamp } from "firebase/firestore"
import { AlertTriangle, Loader2, Save, Download } from "lucide-react"
import { useEffect, useState, useCallback } from "react"
import { toast } from "sonner"
import { formatCHF, formatDate } from "@modules/lib/format"
import { priceListFreshness } from "@/lib/price-list-stale"

export const Route = createFileRoute(
  "/_authenticated/price-lists/$priceListId",
)({
  component: PriceListDetailPage,
})

interface FormValues {
  name: string
  active: boolean
}

/**
 * Workshops shared by every selected item (items without tags don't
 * constrain). Empty result = the selection mixes workshops, which the PDF
 * generator rejects — surface that before the admin hits "herunterladen".
 */
function sharedWorkshops(
  selected: string[],
  catalog: Map<string, string[] | undefined>,
): { shared: string[]; seen: string[] } {
  const tagged = selected
    .map((id) => catalog.get(id) ?? [])
    .filter((ws) => ws.length > 0)
  const seen = [...new Set(tagged.flat())].sort()
  if (tagged.length === 0) return { shared: [], seen }
  let shared = tagged[0]
  for (const ws of tagged.slice(1)) {
    shared = shared.filter((w) => ws.includes(w))
  }
  return { shared, seen }
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
    let downloaded = false
    try {
      const fn = rpcCallable<{ priceListId: string }, { url: string }>(
        functions,
        "catalogCall",
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
      downloaded = true
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "PDF konnte nicht erstellt werden."
      toast.error(message)
    } finally {
      setDownloading(false)
    }
    if (downloaded) {
      // Stamp the generation time so the list view can flag the printed
      // Aushang as veraltet once items drift. Best-effort — silently ignore
      // failures so a Firestore hiccup does not look like a download error.
      try {
        await update(priceListRef(db, priceListId), {
          generatedAt: serverTimestamp() as unknown as null,
        })
      } catch {
        // intentionally silent
      }
    }
  }

  if (loading || catalogLoading) return <PageLoading />
  if (!priceList) return <div>Preisliste nicht gefunden.</div>

  const freshness = priceListFreshness(
    priceList,
    new Map(allCatalog.map((c) => [c.id, c.modifiedAt])),
  )

  const qrUrl = `https://${import.meta.env.VITE_CHECKOUT_DOMAIN}/visit/add/list/${priceListId}`

  // Sort catalog by code for the picker
  const sortedCatalog = [...allCatalog].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true }),
  )

  const { shared, seen } = sharedWorkshops(
    selectedItems,
    new Map(allCatalog.map((c) => [c.id, c.workshops])),
  )
  const mixesWorkshops = selectedItems.length > 0 && shared.length === 0

  return (
    <div className="space-y-4">
      <PageHeader
        title={priceList.name || "Preisliste"}
        backTo="/price-lists"
        backLabel="Zurück zu Preislisten"
      />

      {freshness === "stale" && (
        <div className="flex items-center gap-2.5 rounded-xl border border-destructive/40 border-l-4 border-l-destructive bg-destructive/5 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>
            Veraltet — seit dem Generieren ({formatDate(priceList.generatedAt)})
            haben sich Artikel dieser Liste geändert. PDF neu generieren.
          </span>
        </div>
      )}

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
        <CardContent className="space-y-3">
          {mixesWorkshops && (
            <div className="flex items-center gap-2.5 rounded-xl border border-destructive/40 border-l-4 border-l-destructive bg-destructive/5 px-4 py-3 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
              <span>
                Die Auswahl mischt Werkstätten ({seen.join(", ")}) — eine
                Preisliste gilt für genau eine Werkstatt. Das PDF kann so
                nicht generiert werden.
              </span>
            </div>
          )}
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
                  {item.workshops?.join(", ")}
                </span>
                <span className="text-xs text-muted-foreground w-20 text-right">
                  {formatCHF(item.variants?.[0]?.unitPrice.default ?? 0)}
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
            disabled={selectedItems.length === 0 || mixesWorkshops || downloading}
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
