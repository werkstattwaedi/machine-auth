// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { useCollection, useDocument } from "@/lib/firestore"
import { useAuth } from "@/lib/auth"
import { userRef } from "@/lib/firestore-helpers"
import { formatCHF } from "@/lib/format"
import { PageLoading } from "@/components/page-loading"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { where } from "firebase/firestore"
import { addDoc, collection, serverTimestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { CheckCircle, Loader2, Package } from "lucide-react"
import { useState } from "react"

const materialSearchSchema = z.object({
  id: z.string().optional(),
  group: z.string().optional(),
})

export const Route = createFileRoute("/_material/material/add")({
  validateSearch: materialSearchSchema,
  component: MaterialAddPage,
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

function MaterialAddPage() {
  const { id, group } = Route.useSearch()
  const { userDoc } = useAuth()

  // Single material mode
  const { data: singleMaterial, loading: loadingSingle } = useDocument<MaterialDoc>(
    id ? `materials/${id}` : null
  )

  // Group mode
  const { data: groupMaterials, loading: loadingGroup } = useCollection<MaterialDoc>(
    group ? "materials" : null,
    ...(group ? [where("shortlistGroup", "==", group), where("active", "==", true)] : [])
  )

  const [selectedMaterial, setSelectedMaterial] = useState<(MaterialDoc & { id: string }) | null>(null)
  const [quantity, setQuantity] = useState("1")
  const [lengthCm, setLengthCm] = useState("")
  const [widthCm, setWidthCm] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const loading = loadingSingle || loadingGroup

  if (loading) return <PageLoading />

  // Determine the active material
  const material = selectedMaterial ?? (singleMaterial ? { ...singleMaterial } : null)
  const isGroupMode = !!group && !selectedMaterial

  if (success) {
    return (
      <Card>
        <CardContent className="pt-6 text-center space-y-4">
          <CheckCircle className="h-12 w-12 text-green-600 mx-auto" />
          <h2 className="text-lg font-semibold">Material hinzugefügt</h2>
          <div className="flex flex-col gap-2">
            <Button onClick={() => { setSuccess(false); setSelectedMaterial(null); setQuantity("1") }}>
              Weiteres Material erfassen
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Group selection mode
  if (isGroupMode) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Material auswählen</CardTitle>
        </CardHeader>
        <CardContent>
          {groupMaterials.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Materialien in dieser Gruppe gefunden.</p>
          ) : (
            <div className="space-y-2">
              {groupMaterials.map((m) => (
                <button
                  key={m.id}
                  className="w-full text-left p-3 rounded-md border hover:bg-accent transition-colors"
                  onClick={() => setSelectedMaterial(m)}
                >
                  <div className="font-medium text-sm">{m.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatCHF(m.unitPrice)}/{m.unit}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  if (!material) {
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

  const isArea = material.category === "m2"
  const qty = parseFloat(quantity) || 0
  let totalPrice = 0
  if (isArea) {
    const l = parseFloat(lengthCm) || 0
    const w = parseFloat(widthCm) || 0
    totalPrice = (l / 100) * (w / 100) * material.unitPrice
  } else {
    totalPrice = qty * material.unitPrice
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const anonymousSessionId = getAnonymousSessionId()

      await addDoc(collection(db, "usage_material"), {
        userId: userDoc ? userRef(userDoc.id) : null,
        anonymousSessionId: userDoc ? null : anonymousSessionId,
        materialId: material.id ? (await import("@/lib/firestore-helpers")).materialRef(material.id!) : null,
        workshop: material.workshop,
        description: material.name,
        details: {
          category: material.category,
          quantity: isArea ? 1 : qty,
          lengthCm: isArea ? parseFloat(lengthCm) || null : null,
          widthCm: isArea ? parseFloat(widthCm) || null : null,
          unitPrice: material.unitPrice,
          totalPrice,
        },
        created: serverTimestamp(),
        checkout: null,
        modifiedBy: null,
        modifiedAt: serverTimestamp(),
      })
      setSuccess(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{material.name}</CardTitle>
        {material.description && (
          <p className="text-sm text-muted-foreground">{material.description}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm">
          <span className="text-muted-foreground">Preis: </span>
          {formatCHF(material.unitPrice)}/{material.unit}
        </div>

        {isArea ? (
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
        ) : (
          <div className="space-y-1">
            <Label>Menge ({material.unit})</Label>
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

        <Button className="w-full" onClick={handleSubmit} disabled={submitting || totalPrice <= 0}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Hinzufügen
        </Button>
      </CardContent>
    </Card>
  )
}

function getAnonymousSessionId(): string {
  const key = "oww-anonymous-session"
  let id = localStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(key, id)
  }
  return id
}
