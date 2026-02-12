// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useAuth, type UserDoc } from "@/lib/auth"
import { useCollection } from "@/lib/firestore"
import { where, serverTimestamp } from "firebase/firestore"
import { userRef } from "@/lib/firestore-helpers"
import { useFirestoreMutation } from "@/hooks/use-firestore-mutation"
import { formatCHF, formatDateTime } from "@/lib/format"
import { PageLoading } from "@/components/page-loading"
import { EmptyState } from "@/components/empty-state"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ShoppingCart, Coffee } from "lucide-react"
import { usePricingConfig, getSortedWorkshops } from "@/lib/workshop-config"
import type { WorkshopId } from "@/lib/workshop-config"
import {
  WorkshopInlineSection,
  type ItemCallbacks,
  type LocalMaterialItem,
} from "@/components/usage/inline-rows"

export const Route = createFileRoute("/_authenticated/")({
  component: DashboardPage,
})

interface UsageMachineDoc {
  machine: { id: string }
  checkIn: { toDate(): Date }
  checkOut?: { toDate(): Date } | null
  checkout?: { id: string } | null
  workshop?: string
}

interface UsageMaterialDoc {
  description: string
  type?: "material" | "machine_hours" | "service"
  details?: {
    category?: string
    quantity?: number
    lengthCm?: number
    widthCm?: number
    unitPrice?: number
    totalPrice?: number
    discountLevel?: string
    objectSize?: string
    weight_g?: number
    materialType?: string
    serviceDescription?: string
    serviceCost?: number
  }
  created: { toDate(): Date }
  checkout?: { id: string } | null
  workshop?: string
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
  const ref = userRef(userDoc.id)
  const { data: pricingConfig, loading: loadingConfig } = usePricingConfig()
  const mutation = useFirestoreMutation()

  // Workshop selection state (must be before early returns for hook rules)
  const [selectedWorkshops, setSelectedWorkshops] = useState<Set<WorkshopId>>(new Set())
  const [uncheckConfirm, setUncheckConfirm] = useState<WorkshopId | null>(null)

  // Unchecked-out machine usage
  const { data: machineUsage, loading: loadingMachine } = useCollection<UsageMachineDoc>(
    "usage_machine",
    where("userId", "==", ref), where("checkout", "==", null),
  )

  // Unchecked-out material usage
  const { data: materialUsage, loading: loadingMaterial } = useCollection<UsageMaterialDoc>(
    "usage_material",
    where("userId", "==", ref), where("checkout", "==", null),
  )

  // Strip undefined values — Firestore rejects them in updateDoc/addDoc
  const clean = (obj: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))

  // Firestore-backed callbacks (onBlurSave writes to Firestore)
  const callbacks: ItemCallbacks = useMemo(
    () => ({
      addItem: (item: LocalMaterialItem) => {
        mutation.add("usage_material", {
          userId: ref,
          workshop: item.workshop,
          description: item.description,
          type: item.type,
          details: clean(item.details as Record<string, unknown>),
          created: serverTimestamp(),
          checkout: null,
        })
      },
      updateItem: (_id: string, item: LocalMaterialItem) => {
        mutation.update("usage_material", item.id, {
          description: item.description,
          type: item.type,
          details: clean(item.details as Record<string, unknown>),
        })
      },
      removeItem: (id: string) => {
        mutation.remove("usage_material", id)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ref],
  )

  if (loadingMachine || loadingMaterial || loadingConfig) return <PageLoading />

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

  // Workshops that have existing Firestore items (always shown)
  const workshopsWithItems = new Set<WorkshopId>()
  for (const u of machineUsage) {
    if (u.workshop) workshopsWithItems.add(u.workshop as WorkshopId)
  }
  for (const u of materialUsage) {
    if (u.workshop) workshopsWithItems.add(u.workshop as WorkshopId)
  }

  // Effective set: workshops with existing items + manually selected
  const effectiveWorkshops = new Set([...workshopsWithItems, ...selectedWorkshops])
  const hasUsage = effectiveWorkshops.size > 0

  // Map Firestore material docs → LocalMaterialItem shape for inline rows
  const materialAsLocal: LocalMaterialItem[] = materialUsage.map((u) => ({
    id: u.id,
    description: u.description,
    workshop: u.workshop ?? "",
    type: u.type ?? "material",
    details: {
      category: u.details?.category,
      quantity: u.details?.quantity,
      lengthCm: u.details?.lengthCm,
      widthCm: u.details?.widthCm,
      unitPrice: u.details?.unitPrice,
      totalPrice: u.details?.totalPrice,
      discountLevel: u.details?.discountLevel,
      objectSize: u.details?.objectSize,
      weight_g: u.details?.weight_g,
      materialType: u.details?.materialType,
      serviceDescription: u.details?.serviceDescription,
      serviceCost: u.details?.serviceCost,
    },
  }))

  const materialTotal = materialUsage.reduce(
    (sum, u) => sum + (u.details?.totalPrice ?? 0), 0,
  )

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
    }
  }

  const confirmUncheckWorkshop = async () => {
    if (!uncheckConfirm) return
    const wsId = uncheckConfirm
    const itemsToDelete = materialAsLocal.filter((i) => i.workshop === wsId)
    await Promise.all(
      itemsToDelete.map((i) => mutation.remove("usage_material", i.id)),
    )
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
        Hallo, {userDoc.displayName || userDoc.name}
      </h1>

      {/* Workshop checkbox selector */}
      <div>
        <h2 className="text-lg font-bold mb-2">Werkstätten wählen</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Für welche Werkstätten möchtest du Kosten erfassen?
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {sortedWorkshops.map(([wsId, ws]) => (
            <label key={wsId} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={effectiveWorkshops.has(wsId)}
                onCheckedChange={() => toggleWorkshop(wsId)}
              />
              <span className="text-sm">{ws.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* NFC machine usage (read-only) */}
      {machineUsage.length > 0 && (
        <Card>
          <CardContent className="py-3">
            <h3 className="text-sm font-bold mb-2">Maschinennutzung (NFC)</h3>
            {machineUsage.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-3 py-1 text-sm border-b border-dashed last:border-0"
              >
                <span className="flex-1">
                  {u.machine?.id ?? "Maschine"} ({u.workshop})
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(u.checkIn)}
                  {u.checkOut
                    ? ` – ${formatDateTime(u.checkOut)}`
                    : <span className="text-green-600 ml-1">Aktiv</span>}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Per-workshop inline sections */}
      {sortedWorkshops
        .filter(([wsId]) => effectiveWorkshops.has(wsId))
        .map(([wsId, wsConfig]) => (
          <WorkshopInlineSection
            key={wsId}
            workshopId={wsId}
            workshop={wsConfig}
            config={pricingConfig}
            localItems={materialAsLocal.filter((i) => i.workshop === wsId)}
            existingItems={[]}
            callbacks={callbacks}
            onBlurSave
          />
        ))}

      {/* Empty state when no workshops selected */}
      {!hasUsage && (
        <EmptyState
          icon={Coffee}
          title="Kein aktiver Besuch"
          description="Wähle eine Werkstatt oben, um deine Nutzung zu erfassen."
        />
      )}

      {/* Summary card */}
      {hasUsage && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">
                  Kosten (laufend)
                </div>
                <div className="text-xl font-bold">{formatCHF(materialTotal)}</div>
              </div>
              <Link to="/checkout">
                <Button className="bg-cog-teal hover:bg-cog-teal-dark">
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  Zum Checkout
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
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
