// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Inventar · Etiketten — selection-cart label printing. Left: search /
// filter the catalog, add items (or all matches) to the cart. Right: the
// cart with a live WYSIWYG preview per label, then send everything to
// the Brother printer via the print-job queue (gateway prints).

import { createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { useCollection } from "@modules/lib/firestore"
import { useDb } from "@modules/lib/firebase-context"
import { catalogCollection } from "@modules/lib/firestore-helpers"
import type { CatalogItemDoc } from "@modules/lib/firestore-entities"
import { useAuth } from "@modules/lib/auth"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { buildRasterJob } from "@oww/shared"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { InventoryTabs } from "@/components/admin/inventory-tabs"
import { FilterPills } from "@/components/admin/filter-pills"
import { LabelPreview } from "@/printer/label-preview"
import { useLabelBitmap } from "@/printer/use-label-bitmap"
import {
  renderMaterialLabel,
  type MaterialLabelInput,
} from "@/printer/render-material-label"
import { enqueuePrintJob } from "@/printer/enqueue-print-job"
import { buildItemLabelQrUrl } from "@/printer/item-label-qr-url"
import { Button } from "@modules/components/ui/button"
import { Card } from "@modules/components/ui/card"
import { Input } from "@modules/components/ui/input"
import { EmptyState } from "@modules/components/empty-state"
import { Check, Loader2, Plus, Printer, Search, Tag, X } from "lucide-react"
import { toast } from "sonner"

export const Route = createFileRoute("/_authenticated/materials/labels")({
  component: LabelsPage,
})

type CatalogRow = CatalogItemDoc & { id: string }

const TAPE = "18mm" as const

function labelInput(
  checkoutDomain: string,
  item: CatalogRow,
): MaterialLabelInput {
  return {
    url: buildItemLabelQrUrl(checkoutDomain, item.code),
    // Curated label fields from the pricelist import when present; items
    // created by hand fall back to the composed display name, no mass line.
    name: item.labelName ?? item.name,
    mass: item.labelMass,
    code: `#${item.code}`,
    tape: TAPE,
  }
}

function LabelsPage() {
  const db = useDb()
  const { user } = useAuth()
  const { data: catalog, loading } = useCollection(catalogCollection(db))
  const [search, setSearch] = useState("")
  const [workshop, setWorkshop] = useState("all")
  const [cart, setCart] = useState<string[]>([])

  const print = useAsyncMutation({
    context: "admin.printLabelBatch",
    // No static errorMessage: the gateway returns user-ready German
    // printer errors as the thrown message.
  })

  const checkoutDomain = import.meta.env.VITE_CHECKOUT_DOMAIN as string
  const canPrint = Boolean(checkoutDomain)

  const workshops = useMemo(
    () =>
      [...new Set(catalog.flatMap((c) => c.workshops ?? []))].sort((a, b) =>
        a.localeCompare(b, "de-CH"),
      ),
    [catalog],
  )

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return catalog
      .filter((item) => item.active)
      .filter(
        (item) => workshop === "all" || (item.workshops ?? []).includes(workshop),
      )
      .filter(
        (item) =>
          !needle ||
          item.name.toLowerCase().includes(needle) ||
          item.code.includes(needle),
      )
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
  }, [catalog, search, workshop])

  const cartItems = cart
    .map((id) => catalog.find((c) => c.id === id))
    .filter((c): c is CatalogRow => !!c)

  const addAll = () => {
    setCart((prev) => [
      ...prev,
      ...matches.map((m) => m.id).filter((id) => !prev.includes(id)),
    ])
  }

  const handlePrint = async () => {
    if (!user || cartItems.length === 0) return
    try {
      await print.mutate(async () => {
        // Sequential: the gateway prints one job at a time anyway, and
        // sequential submission keeps the labels in cart order.
        for (const item of cartItems) {
          const bitmap = await renderMaterialLabel(
            labelInput(checkoutDomain, item),
          )
          const bytes = buildRasterJob(bitmap, { tape: TAPE })
          await enqueuePrintJob(db, { bytes, tape: TAPE, uid: user.uid })
        }
      })
    } catch {
      // useAsyncMutation already toasted + logged.
      return
    }
    toast.success(`${cartItems.length} Etiketten gedruckt.`)
    setCart([])
  }

  if (loading) return <PageLoading />

  return (
    <div className="space-y-4">
      <PageHeader title="Inventar" />
      <InventoryTabs />

      {!canPrint && (
        <Card className="border-destructive p-4 text-sm text-destructive">
          Kein Checkout-Domain konfiguriert — Etiketten-QR-Codes können nicht
          erzeugt werden.
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: browse + add */}
        <div className="space-y-3">
          <h3 className="font-heading text-sm font-bold">Katalog durchsuchen</h3>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Artikel oder Code suchen …"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <FilterPills
            options={[
              { value: "all", label: "Alle" },
              ...workshops.map((w) => ({ value: w, label: w })),
            ]}
            value={workshop}
            onChange={setWorkshop}
          />
          <Card className="divide-y px-4 py-1">
            {matches.slice(0, 30).map((item) => {
              const inCart = cart.includes(item.id)
              return (
                <div key={item.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="flex-1">
                    {item.name}{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      {item.code}
                    </span>
                  </span>
                  {inCart ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Check className="h-3.5 w-3.5" />
                      im Korb
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCart((prev) => [...prev, item.id])}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Hinzufügen
                    </Button>
                  )}
                </div>
              )
            })}
            {matches.length === 0 && (
              <div className="py-4 text-sm text-muted-foreground">
                Keine Treffer.
              </div>
            )}
            {matches.length > 30 && (
              <div className="py-2 text-xs text-muted-foreground">
                {matches.length - 30} weitere Treffer — Suche verfeinern oder
                alle hinzufügen.
              </div>
            )}
          </Card>
          {matches.length > 0 && (
            <Button variant="outline" size="sm" onClick={addAll}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Alle Treffer hinzufügen ({matches.length})
            </Button>
          )}
        </div>

        {/* Right: cart with previews */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-heading text-sm font-bold">
              Etiketten-Korb · {cartItems.length}
            </h3>
            {cartItems.length > 0 && (
              <button
                type="button"
                className="text-sm font-medium text-primary hover:underline"
                onClick={() => setCart([])}
              >
                Korb leeren
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Vorschau · 18-mm-Band · QR-Code + Bezeichnung · Druck schwarz/weiss
          </p>
          {cartItems.length === 0 ? (
            <EmptyState
              icon={Tag}
              title="Korb ist leer"
              description="Links Artikel suchen und hinzufügen."
            />
          ) : (
            <div className="space-y-2">
              {cartItems.map((item) => (
                <CartLabel
                  key={item.id}
                  item={item}
                  checkoutDomain={checkoutDomain}
                  enabled={canPrint}
                  onRemove={() =>
                    setCart((prev) => prev.filter((id) => id !== item.id))
                  }
                />
              ))}
            </div>
          )}
          {cartItems.length > 0 && canPrint && (
            <Button className="w-full" onClick={handlePrint} disabled={print.loading}>
              {print.loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Printer className="mr-2 h-4 w-4" />
              )}
              An Etikettendrucker senden ({cartItems.length})
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function CartLabel({
  item,
  checkoutDomain,
  enabled,
  onRemove,
}: {
  item: CatalogRow
  checkoutDomain: string
  enabled: boolean
  onRemove: () => void
}) {
  const { bitmap, loading } = useLabelBitmap(
    enabled ? labelInput(checkoutDomain, item) : null,
    enabled,
  )
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-2 pr-3">
      <LabelPreview bitmap={bitmap} loading={loading} displayHeight={56} />
      <span className="flex-1 truncate text-sm font-medium">{item.name}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`${item.name} aus Korb entfernen`}
        onClick={onRemove}
      >
        <X className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  )
}
