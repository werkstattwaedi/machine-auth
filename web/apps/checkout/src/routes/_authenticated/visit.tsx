// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useAuth, type UserDoc } from "@modules/lib/auth"
import { useCollection } from "@modules/lib/firestore"
import {
  where,
  orderBy,
  arrayUnion,
  arrayRemove,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  collection,
  serverTimestamp,
} from "firebase/firestore"
import { userRef } from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import { formatCHF } from "@modules/lib/format"
import { PageLoading } from "@modules/components/page-loading"
import { EmptyState } from "@modules/components/empty-state"
import { Button } from "@modules/components/ui/button"
import { Checkbox } from "@modules/components/ui/checkbox"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@modules/components/ui/alert-dialog"
import { ShoppingCart, Coffee } from "lucide-react"
import {
  usePricingConfig,
  getSortedWorkshops,
} from "@modules/lib/workshop-config"
import type { WorkshopId, DiscountLevel, PricingModel } from "@modules/lib/workshop-config"
import { type CheckoutItemLocal, type ItemCallbacks } from "@/components/usage/inline-rows"
import { WorkshopSectionWithCatalog } from "@/components/usage/workshop-section-with-catalog"

export const Route = createFileRoute("/_authenticated/visit")({
  component: DashboardPage,
})

interface CheckoutDoc {
  userId: { id: string }
  status: "open" | "closed"
  usageType: string
  workshopsVisited: string[]
  created: { toDate(): Date }
}

interface CheckoutItemDoc {
  workshop: string
  description: string
  origin: "nfc" | "manual" | "qr"
  catalogId: { id: string; path: string } | null
  pricingModel?: string | null
  quantity: number
  unitPrice: number
  totalPrice: number
  formInputs?: { quantity: number; unit: string }[]
}

function DashboardPage() {
  const { userDoc, userDocLoading } = useAuth()

  if (userDocLoading) return <PageLoading />
  if (!userDoc) {
    return (
      <EmptyState
        icon={Coffee}
        title="Konto nicht gefunden"
        description="Dein Benutzerkonto konnte nicht geladen werden. Bitte melde dich erneut an."
      />
    )
  }

  return <DashboardContent userDoc={userDoc} />
}

function DashboardContent({ userDoc }: { userDoc: UserDoc }) {
  const db = useDb()
  const ref = userRef(db, userDoc.id)
  const { data: pricingConfig, loading: loadingConfig } = usePricingConfig()

  // Workshop selection state
  const [selectedWorkshops, setSelectedWorkshops] = useState<Set<WorkshopId>>(new Set())
  const [uncheckConfirm, setUncheckConfirm] = useState<WorkshopId | null>(null)

  // Find user's open checkout
  const { data: openCheckouts, loading: loadingCheckout } = useCollection<CheckoutDoc>(
    "checkouts",
    where("userId", "==", ref),
    where("status", "==", "open"),
  )
  const openCheckout = openCheckouts[0] ?? null
  const checkoutId = openCheckout?.id ?? null

  // Load checkout items
  const { data: checkoutItems, loading: loadingItems } = useCollection<CheckoutItemDoc>(
    checkoutId ? `checkouts/${checkoutId}/items` : null,
    orderBy("created"),
  )

  // Determine user's discount level
  const discountLevel: DiscountLevel = userDoc.roles?.includes("vereinsmitglied")
    ? "member"
    : "none"

  // Map Firestore items → local shape
  const items: CheckoutItemLocal[] = useMemo(
    () =>
      checkoutItems.map((item) => ({
        id: item.id,
        workshop: item.workshop,
        description: item.description,
        origin: item.origin,
        catalogId: item.catalogId?.id ?? null,
        pricingModel: (item.pricingModel as PricingModel) ?? null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        formInputs: item.formInputs,
      })),
    [checkoutItems],
  )

  // Firestore-backed item callbacks
  const callbacks: ItemCallbacks = useMemo(
    () => ({
      addItem: async (item: CheckoutItemLocal) => {
        let coId = checkoutId
        // Create checkout first, then add item (sequential so security
        // rules can read the parent checkout when validating the item)
        if (!coId) {
          const coRef = await addDoc(collection(db, "checkouts"), {
            userId: ref,
            status: "open",
            usageType: "regular",
            created: serverTimestamp(),
            workshopsVisited: [item.workshop],
            persons: [],
            modifiedBy: null,
            modifiedAt: serverTimestamp(),
          })
          coId = coRef.id
        }
        await addDoc(collection(db, "checkouts", coId, "items"), {
          workshop: item.workshop,
          description: item.description,
          origin: item.origin,
          catalogId: item.catalogId ? doc(db, "catalog", item.catalogId) : null,
          pricingModel: item.pricingModel ?? null,
          created: serverTimestamp(),
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          formInputs: item.formInputs ?? null,
        })
      },
      updateItem: (_id: string, item: CheckoutItemLocal) => {
        if (!checkoutId) return
        updateDoc(doc(db, "checkouts", checkoutId, "items", item.id), {
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          formInputs: item.formInputs ?? null,
        })
      },
      removeItem: (id: string) => {
        if (!checkoutId) return
        deleteDoc(doc(db, "checkouts", checkoutId, "items", id))
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checkoutId, ref],
  )

  if (loadingCheckout || loadingItems || loadingConfig) return <PageLoading />

  if (!pricingConfig) {
    return (
      <EmptyState
        icon={Coffee}
        title="Konfiguration wird geladen..."
        description="Bitte warte einen Moment."
      />
    )
  }

  const sortedWorkshops = getSortedWorkshops(pricingConfig)

  // Workshops that have existing items (always shown)
  const workshopsWithItems = new Set<WorkshopId>()
  for (const item of items) {
    if (item.workshop) workshopsWithItems.add(item.workshop as WorkshopId)
  }
  // Also include workshopsVisited from checkout
  if (openCheckout?.workshopsVisited) {
    for (const ws of openCheckout.workshopsVisited) {
      workshopsWithItems.add(ws as WorkshopId)
    }
  }

  const effectiveWorkshops = new Set([...workshopsWithItems, ...selectedWorkshops])
  const hasUsage = effectiveWorkshops.size > 0

  const itemsTotal = items.reduce((sum, i) => sum + i.totalPrice, 0)

  const toggleWorkshop = (wsId: WorkshopId) => {
    const hasExistingItems = workshopsWithItems.has(wsId)
    const isSelected = selectedWorkshops.has(wsId) || hasExistingItems

    if (isSelected) {
      if (hasExistingItems) {
        setUncheckConfirm(wsId)
        return
      }
      setSelectedWorkshops((prev) => {
        const next = new Set(prev)
        next.delete(wsId)
        return next
      })
    } else {
      setSelectedWorkshops((prev) => new Set(prev).add(wsId))
      // Update workshopsVisited on checkout if it exists
      if (checkoutId) {
        updateDoc(doc(db, "checkouts", checkoutId), {
          workshopsVisited: arrayUnion(wsId),
          modifiedAt: serverTimestamp(),
        })
      }
    }
  }

  const confirmUncheckWorkshop = async () => {
    if (!uncheckConfirm || !checkoutId) return
    const wsId = uncheckConfirm
    const itemsToDelete = items.filter(
      (i) => i.workshop === wsId && i.origin !== "nfc",
    )
    await Promise.all(
      itemsToDelete.map((i) =>
        deleteDoc(doc(db, "checkouts", checkoutId, "items", i.id)),
      ),
    )
    // Update workshopsVisited
    await updateDoc(doc(db, "checkouts", checkoutId), {
      workshopsVisited: arrayRemove(wsId),
      modifiedAt: serverTimestamp(),
    })
    setSelectedWorkshops((prev) => {
      const next = new Set(prev)
      next.delete(wsId)
      return next
    })
    setUncheckConfirm(null)
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">
        Hallo, {userDoc.displayName}
      </h1>

      {/* Workshop checkbox selector */}
      <div>
        <h2 className="text-lg font-bold mb-2">Werkstätten wählen</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Für welche Werkstätten möchtest du Kosten erfassen?
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {sortedWorkshops.map(([wsId, ws]) => {
            const hasItems = workshopsWithItems.has(wsId)
            return (
              <label key={wsId} className={`flex items-center gap-2 ${hasItems ? "cursor-default" : "cursor-pointer"}`}>
                <Checkbox
                  checked={effectiveWorkshops.has(wsId)}
                  disabled={hasItems}
                  onCheckedChange={() => toggleWorkshop(wsId)}
                />
                <span className="text-sm">{ws.label}</span>
              </label>
            )
          })}
        </div>
      </div>

      {/* Per-workshop inline sections */}
      {sortedWorkshops
        .filter(([wsId]) => effectiveWorkshops.has(wsId))
        .map(([wsId, wsConfig]) => (
          <WorkshopSectionWithCatalog
            key={wsId}
            workshopId={wsId}
            workshop={wsConfig}
            config={pricingConfig}
            items={items.filter((i) => i.workshop === wsId)}
            callbacks={callbacks}
            discountLevel={discountLevel}
            checkoutId={checkoutId}
          />
        ))}

      {/* Empty state */}
      {!hasUsage && (
        <EmptyState
          icon={Coffee}
          title="Kein aktiver Besuch"
          description="Wähle eine Werkstatt oben, um deine Nutzung zu erfassen."
        />
      )}

      {/* Summary card — sticky at viewport bottom so the checkout button is always reachable */}
      {hasUsage && (
        <div className="sticky bottom-0 bg-background border-t pt-4 pb-4 -mx-4 px-4 sm:-mx-6 sm:px-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">
                Kosten (laufend)
              </div>
              <div className="text-xl font-bold">{formatCHF(itemsTotal)}</div>
            </div>
            <Link to="/" search={{ step: "summary" }}>
              <Button className="bg-cog-teal hover:bg-cog-teal-dark">
                <ShoppingCart className="h-4 w-4 mr-2" />
                Zum Checkout
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* Uncheck workshop confirmation dialog */}
      <AlertDialog open={!!uncheckConfirm} onOpenChange={(v) => { if (!v) setUncheckConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Werkstatt entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              Alle erfassten Einträge für diese Werkstatt werden gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmUncheckWorkshop}>
              Entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

