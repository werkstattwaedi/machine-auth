// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { z } from "zod/v4/mini"
import { useDocument, useCollection } from "@modules/lib/firestore"
import { useAuth } from "@modules/lib/auth"
import { userRef } from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import { formatCHF } from "@modules/lib/format"
import { PageLoading } from "@modules/components/page-loading"
import { Card, CardContent, CardHeader, CardTitle } from "@modules/components/ui/card"
import { Button } from "@modules/components/ui/button"
import { Input } from "@modules/components/ui/input"
import { Label } from "@modules/components/ui/label"
import { where, addDoc, collection, doc, serverTimestamp, getDocs, query, documentId, writeBatch } from "firebase/firestore"
import { CheckCircle, Loader2, Package, ArrowLeft, LogIn } from "lucide-react"
import { useState } from "react"
import type { CatalogItem, PriceList } from "@modules/lib/workshop-config"
import { getShortUnit } from "@modules/lib/workshop-config"
import { computePricing } from "@modules/lib/pricing-calc"

const materialSearchSchema = z.object({
  id: z.optional(z.string()),
  priceList: z.optional(z.string()),
})

export const Route = createFileRoute("/_material/material/add")({
  validateSearch: materialSearchSchema,
  component: MaterialAddPage,
})

function MaterialAddPage() {
  const db = useDb()
  const { id, priceList: priceListId } = Route.useSearch()
  const { user, userDoc, loading: authLoading } = useAuth()

  const { data: priceListDoc, loading: priceListLoading } = useDocument<PriceList>(
    priceListId ? `price_lists/${priceListId}` : null,
  )

  // Load catalog items for the price list picker
  const priceListItems = priceListDoc?.items ?? []
  const { data: priceListCatalog, loading: priceListCatalogLoading } =
    useCollection<CatalogItem>(
      // Firestore 'in' queries support max 30 items
      priceListId && !id && priceListItems.length > 0 ? "catalog" : null,
      ...(priceListItems.length > 0
        ? [where(documentId(), "in", priceListItems.slice(0, 30))]
        : []),
    )

  const { data: catalogItem, loading } = useDocument<CatalogItem>(
    id ? `catalog/${id}` : null,
  )

  const [quantity, setQuantity] = useState("1")
  const [lengthCm, setLengthCm] = useState("")
  const [widthCm, setWidthCm] = useState("")
  const [weightG, setWeightG] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  // Require authentication for all material operations
  if (authLoading) return <PageLoading />
  if (!user || !userDoc) {
    return (
      <Card>
        <CardContent className="pt-6 text-center space-y-4">
          <LogIn className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Bitte melde dich an, um Material zu erfassen.
          </p>
          <Link to="/login">
            <Button className="w-full">Anmelden</Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  // Price list item picker: show when priceList is set but id is not
  if (priceListId && !id) {
    if (priceListLoading || priceListCatalogLoading) return <PageLoading />
    if (!priceListDoc) {
      return (
        <Card>
          <CardContent className="pt-6 text-center">
            <Package className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Preisliste nicht gefunden.
            </p>
          </CardContent>
        </Card>
      )
    }

    const sorted = [...priceListCatalog].sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true }),
    )

    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold">{priceListDoc.name}</h1>
        {sorted.map((item) => (
          <Link
            key={item.id}
            to="/material/add"
            search={{ priceList: priceListId, id: item.id }}
            className="block"
          >
            <Card className="hover:bg-muted transition-colors cursor-pointer">
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <span className="font-mono text-xs mr-3">{item.code}</span>
                  <span className="text-sm font-medium">{item.name}</span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {formatCHF(item.unitPrice?.none ?? 0)}/{getShortUnit(item.pricingModel)}
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    )
  }

  if (loading) return <PageLoading />

  if (success) {
    return (
      <Card>
        <CardContent className="pt-6 text-center space-y-4">
          <CheckCircle className="h-12 w-12 text-green-600 mx-auto" />
          <h2 className="text-lg font-semibold">Material hinzugefügt</h2>
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => {
                setSuccess(false)
                setQuantity("1")
                setLengthCm("")
                setWidthCm("")
                setWeightG("")
              }}
            >
              Weiteres Material erfassen
            </Button>
            {priceListId && (
              <Link to="/material/add" search={{ priceList: priceListId }}>
                <Button variant="outline" className="w-full">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Zurück zur Liste
                </Button>
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!catalogItem || !id) {
    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <Package className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Material nicht gefunden. Bitte QR-Code erneut scannen.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Determine discount level
  const discountLevel: "none" | "member" | "intern" = userDoc.roles?.includes(
    "vereinsmitglied",
  )
    ? "member"
    : "none"
  const unitPrice = catalogItem.unitPrice[discountLevel] ?? catalogItem.unitPrice.none ?? 0

  // Compute quantity and price based on pricing model
  const pm = catalogItem.pricingModel
  const pricing = computePricing(pm, unitPrice, {
    quantity: parseFloat(quantity) || 0,
    lengthCm: parseFloat(lengthCm) || 0,
    widthCm: parseFloat(widthCm) || 0,
    weightG: parseFloat(weightG) || 0,
  })
  const { quantity: computedQty, totalPrice, formInputs } = pricing

  const handleSubmit = async () => {
    if (totalPrice <= 0) return
    setSubmitting(true)
    try {
      const uRef = userRef(db, userDoc.id)

      // Find or create open checkout
      const coQuery = query(
        collection(db, "checkouts"),
        where("userId", "==", uRef),
        where("status", "==", "open"),
      )
      const coSnap = await getDocs(coQuery)
      let checkoutId: string
      if (coSnap.empty) {
        // Create checkout + item atomically
        const batch = writeBatch(db)
        const coRef = doc(collection(db, "checkouts"))
        batch.set(coRef, {
          userId: uRef,
          status: "open",
          usageType: "regular",
          created: serverTimestamp(),
          workshopsVisited: catalogItem.workshops.length > 0 ? [catalogItem.workshops[0]] : [],
          persons: [],
          modifiedBy: null,
          modifiedAt: serverTimestamp(),
        })
        const itemRef = doc(collection(db, "checkouts", coRef.id, "items"))
        batch.set(itemRef, {
          workshop: catalogItem.workshops[0] ?? "",
          description: catalogItem.name,
          origin: "qr",
          catalogId: doc(db, "catalog", id),
          pricingModel: catalogItem.pricingModel ?? null,
          created: serverTimestamp(),
          quantity: computedQty,
          unitPrice,
          totalPrice,
          formInputs,
        })
        await batch.commit()
        checkoutId = coRef.id
      } else {
        checkoutId = coSnap.docs[0].id
        // Add item to existing checkout
        await addDoc(collection(db, "checkouts", checkoutId, "items"), {
          workshop: catalogItem.workshops[0] ?? "",
          description: catalogItem.name,
          origin: "qr",
          catalogId: doc(db, "catalog", id),
          pricingModel: catalogItem.pricingModel ?? null,
          created: serverTimestamp(),
          quantity: computedQty,
          unitPrice,
          totalPrice,
          formInputs,
        })
      }
      setSuccess(true)
    } finally {
      setSubmitting(false)
    }
  }

  const unitLabel = getShortUnit(pm)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{catalogItem.name}</CardTitle>
        {catalogItem.description && (
          <p className="text-sm text-muted-foreground">
            {catalogItem.description}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm">
          <span className="text-muted-foreground">Preis: </span>
          {formatCHF(unitPrice)}/{unitLabel}
        </div>

        {pm === "area" ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Länge (cm)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={lengthCm}
                onChange={(e) => setLengthCm(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Breite (cm)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={widthCm}
                onChange={(e) => setWidthCm(e.target.value)}
              />
            </div>
          </div>
        ) : pm === "length" ? (
          <div className="space-y-1">
            <Label>Länge (cm)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={lengthCm}
              onChange={(e) => setLengthCm(e.target.value)}
            />
          </div>
        ) : pm === "weight" ? (
          <div className="space-y-1">
            <Label>Gewicht (g)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={weightG}
              onChange={(e) => setWeightG(e.target.value)}
            />
          </div>
        ) : pm === "direct" ? (
          <div className="space-y-1">
            <Label>Betrag (CHF)</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.05"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-1">
            <Label>
              Menge ({pm === "time" ? "Std." : "Stk."})
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
        )}

        <div className="text-right text-lg font-bold">
          {formatCHF(totalPrice)}
        </div>

        <Button
          className="w-full"
          onClick={handleSubmit}
          disabled={submitting || totalPrice <= 0}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : null}
          Hinzufügen
        </Button>

        {priceListId && (
          <Link to="/material/add" search={{ priceList: priceListId }}>
            <Button variant="outline" className="w-full">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Zurück zur Liste
            </Button>
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
