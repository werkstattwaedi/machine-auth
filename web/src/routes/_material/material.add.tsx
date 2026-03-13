// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { useDocument } from "@/lib/firestore"
import { useAuth } from "@/lib/auth"
import { userRef } from "@/lib/firestore-helpers"
import { formatCHF } from "@/lib/format"
import { PageLoading } from "@/components/page-loading"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { where, addDoc, collection, doc, serverTimestamp, getDocs, query } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { CheckCircle, Loader2, Package } from "lucide-react"
import { useState } from "react"
import type { CatalogItem } from "@/lib/workshop-config"
import { getShortUnit } from "@/lib/workshop-config"
import { computePricing } from "@/lib/pricing-calc"

const materialSearchSchema = z.object({
  id: z.string().optional(),
})

export const Route = createFileRoute("/_material/material/add")({
  validateSearch: materialSearchSchema,
  component: MaterialAddPage,
})

function MaterialAddPage() {
  const { id } = Route.useSearch()
  const { userDoc } = useAuth()

  const { data: catalogItem, loading } = useDocument<CatalogItem>(
    id ? `catalog/${id}` : null,
  )

  const [quantity, setQuantity] = useState("1")
  const [lengthCm, setLengthCm] = useState("")
  const [widthCm, setWidthCm] = useState("")
  const [weightG, setWeightG] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

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

  if (!userDoc) {
    return (
      <Card>
        <CardContent className="pt-6 text-center space-y-4">
          <Package className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Bitte melde dich an, um Material zu erfassen.
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
      const uRef = userRef(userDoc.id)

      // Find or create open checkout
      const coQuery = query(
        collection(db, "checkouts"),
        where("userId", "==", uRef),
        where("status", "==", "open"),
      )
      const coSnap = await getDocs(coQuery)
      let checkoutId: string
      if (coSnap.empty) {
        const coRef = await addDoc(collection(db, "checkouts"), {
          userId: uRef,
          status: "open",
          usageType: "regular",
          created: serverTimestamp(),
          workshopsVisited: catalogItem.workshops.length > 0 ? [catalogItem.workshops[0]] : [],
          persons: [],
          modifiedBy: null,
          modifiedAt: serverTimestamp(),
        })
        checkoutId = coRef.id
      } else {
        checkoutId = coSnap.docs[0].id
      }

      // Add item to checkout
      await addDoc(collection(db, "checkouts", checkoutId, "items"), {
        workshop: catalogItem.workshops[0] ?? "",
        description: catalogItem.name,
        origin: "qr",
        catalogId: doc(db, "catalog", id),
        created: serverTimestamp(),
        quantity: computedQty,
        unitPrice,
        totalPrice,
        formInputs,
      })
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
      </CardContent>
    </Card>
  )
}
