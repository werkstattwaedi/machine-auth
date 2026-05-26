// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo, useRef, useEffect, useCallback } from "react"
import {
  createFileRoute,
  Outlet,
  useNavigate,
} from "@tanstack/react-router"
import { useDb } from "@modules/lib/firebase-context"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { useIsMobile } from "@modules/hooks/use-mobile"
import { Checkbox } from "@modules/components/ui/checkbox"
import { Button } from "@modules/components/ui/button"
import { EmptyState } from "@modules/components/empty-state"
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
import { ArrowLeft, ArrowRight, Coffee, ShoppingCart } from "lucide-react"
import { arrayRemove, arrayUnion } from "firebase/firestore"
import {
  checkoutItemRef,
  checkoutRef,
} from "@modules/lib/firestore-helpers"
import {
  getSortedWorkshops,
  type WorkshopId,
} from "@modules/lib/workshop-config"
import { formatCHF } from "@modules/lib/format"
import { WorkshopSectionWithCatalog } from "@/components/usage/workshop-section-with-catalog"
import { ScanFab } from "@/components/qr-scanner/scan-fab"
import { useWizardContext } from "@/components/checkout/wizard-context"
import { NoCheckoutGate } from "@/components/checkout/no-checkout-gate"

export const Route = createFileRoute("/_wizard/visit")({
  component: VisitRoute,
})

function VisitRoute() {
  const { openCheckout } = useWizardContext()

  // C4 guard: navigating directly to /visit without an open checkout
  // shows a "Kein offener Besuch" dialog instead of the workshop UI.
  // Loop-safe: explicit click to /checkin, no auto-redirect.
  if (!openCheckout) {
    return <NoCheckoutGate />
  }
  return <VisitContent />
}

function VisitContent() {
  const navigate = useNavigate()
  const db = useDb()
  const { update, remove } = useFirestoreMutation()
  const isMobile = useIsMobile()
  const ctx = useWizardContext()
  const {
    checkoutId,
    openCheckout,
    items,
    pricingConfig,
    discountLevel,
    addItem,
    updateItem,
    removeItem,
    kiosk,
  } = ctx

  const toggleVisitedMutation = useAsyncMutation({
    context: "visit.toggleWorkshopVisited",
    errorMessage: "Werkstattauswahl konnte nicht gespeichert werden",
  })
  const uncheckWorkshop = useAsyncMutation({
    context: "visit.confirmUncheckWorkshop",
    errorMessage: "Workshop konnte nicht entfernt werden",
  })

  const sortedWorkshops = useMemo(
    () => getSortedWorkshops(pricingConfig),
    [pricingConfig],
  )

  const workshopsWithItems = useMemo(() => {
    const s = new Set<WorkshopId>()
    for (const item of items) {
      if (item.workshop) s.add(item.workshop as WorkshopId)
    }
    return s
  }, [items])

  const visitedWorkshops = useMemo(() => {
    const s = new Set<WorkshopId>()
    for (const ws of openCheckout?.workshopsVisited ?? []) {
      s.add(ws as WorkshopId)
    }
    return s
  }, [openCheckout?.workshopsVisited])

  // Workshops the user manually selected via the checkbox grid (not yet
  // backed by a stored visit). Tracked separately from
  // workshopsWithItems / visitedWorkshops so the snapshot doesn't drift
  // when items arrive after a re-mount (issue #99).
  const [manuallySelectedWorkshops, setManuallySelectedWorkshops] = useState<
    Set<WorkshopId>
  >(() => new Set())
  const [uncheckConfirm, setUncheckConfirm] = useState<WorkshopId | null>(null)

  const effectiveWorkshops = useMemo(() => {
    const combined = new Set<WorkshopId>(manuallySelectedWorkshops)
    for (const w of workshopsWithItems) combined.add(w)
    for (const w of visitedWorkshops) combined.add(w)
    return combined
  }, [manuallySelectedWorkshops, workshopsWithItems, visitedWorkshops])

  const toggleWorkshop = (wsId: WorkshopId) => {
    const hasExistingItems = workshopsWithItems.has(wsId)
    const isOn = effectiveWorkshops.has(wsId)

    if (isOn) {
      if (hasExistingItems) {
        setUncheckConfirm(wsId)
        return
      }
      setManuallySelectedWorkshops((prev) => {
        const next = new Set(prev)
        next.delete(wsId)
        return next
      })
      if (checkoutId && visitedWorkshops.has(wsId)) {
        void toggleVisitedMutation
          .mutate(() =>
            update(checkoutRef(db, checkoutId), {
              workshopsVisited: arrayRemove(wsId),
            }),
          )
          .catch(() => {})
      }
    } else {
      setManuallySelectedWorkshops((prev) => new Set(prev).add(wsId))
      if (checkoutId) {
        void toggleVisitedMutation
          .mutate(() =>
            update(checkoutRef(db, checkoutId), {
              workshopsVisited: arrayUnion(wsId),
            }),
          )
          .catch(() => {})
      }
    }
  }

  const confirmUncheckWorkshop = async () => {
    if (!uncheckConfirm || !checkoutId) return
    const wsId = uncheckConfirm
    const itemsToDelete = items.filter(
      (i) => i.workshop === wsId && i.origin !== "nfc",
    )
    try {
      await uncheckWorkshop.mutate(async () => {
        await Promise.all(
          itemsToDelete.map((i) => remove(checkoutItemRef(db, checkoutId, i.id))),
        )
        await update(checkoutRef(db, checkoutId), {
          workshopsVisited: arrayRemove(wsId),
        })
      })
    } catch {
      return
    }
    setManuallySelectedWorkshops((prev) => {
      const next = new Set(prev)
      next.delete(wsId)
      return next
    })
    setUncheckConfirm(null)
  }

  // Scroll the most recently added workshop section into view on mobile.
  const sectionRefs = useRef<Map<WorkshopId, HTMLDivElement>>(new Map())
  const registerSectionRef = useCallback(
    (wsId: WorkshopId) => (el: HTMLDivElement | null) => {
      if (el) sectionRefs.current.set(wsId, el)
      else sectionRefs.current.delete(wsId)
    },
    [],
  )
  const prevSelectedRef = useRef<Set<WorkshopId>>(effectiveWorkshops)
  useEffect(() => {
    const prev = prevSelectedRef.current
    const added: WorkshopId[] = []
    for (const wsId of effectiveWorkshops) {
      if (!prev.has(wsId)) added.push(wsId)
    }
    prevSelectedRef.current = effectiveWorkshops
    if (added.length !== 1) return
    const wsId = added[0]
    const raf = requestAnimationFrame(() => {
      const el = sectionRefs.current.get(wsId)
      el?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
    return () => cancelAnimationFrame(raf)
  }, [effectiveWorkshops])

  const callbacks = useMemo(
    () => ({ addItem, updateItem, removeItem }),
    [addItem, updateItem, removeItem],
  )

  const itemsTotal = items.reduce((sum, i) => sum + i.totalPrice, 0)
  const hasUsage = effectiveWorkshops.size > 0

  return (
    <>
      <div className="flex flex-col flex-1 gap-8">
        <div>
          <h2 className="text-xl font-bold font-body mb-2">
            Werkstätten wählen
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Für welche Werkstätten möchtest du Kosten erfassen?
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {sortedWorkshops.map(([wsId, ws], i) => {
              const hasItems = workshopsWithItems.has(wsId)
              // Column-first order: balanced columns
              const cols = isMobile ? 2 : 3
              const n = sortedWorkshops.length
              const rows = Math.ceil(n / cols)
              const fullCols = n - (rows - 1) * cols
              let col: number, row: number
              if (i < fullCols * rows) {
                col = Math.floor(i / rows)
                row = i % rows
              } else {
                const j = i - fullCols * rows
                col = fullCols + Math.floor(j / (rows - 1))
                row = j % (rows - 1)
              }
              const order = row * cols + col
              return (
                <label
                  key={wsId}
                  className={`flex items-center gap-2 ${
                    hasItems ? "cursor-default" : "cursor-pointer"
                  }`}
                  style={{ order }}
                >
                  <Checkbox
                    checked={effectiveWorkshops.has(wsId)}
                    disabled={false}
                    onCheckedChange={() => toggleWorkshop(wsId)}
                  />
                  <span className="text-sm">{ws.label}</span>
                </label>
              )
            })}
          </div>
        </div>

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
              sectionRef={registerSectionRef(wsId)}
              onAddMaterial={() =>
                navigate({
                  to: "/visit/add/workshop/$workshopId",
                  params: { workshopId: wsId },
                  search: kiosk ? { kiosk: "" } : {},
                })
              }
            />
          ))}

        {!hasUsage && (
          <EmptyState
            icon={Coffee}
            title="Kein aktiver Besuch"
            description="Wähle eine Werkstatt oben, um deine Nutzung zu erfassen."
          />
        )}

        <div className="flex-1" />

        {/* Sticky bottom navigation */}
        <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background border-t border-border flex items-center gap-3 justify-between">
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-cog-teal border border-cog-teal rounded-[3px] bg-white hover:bg-cog-teal-light transition-colors"
            onClick={() =>
              navigate({
                to: "/checkin",
                search: kiosk ? { kiosk: "" } : {},
              })
            }
          >
            <ArrowLeft className="h-4 w-4" />
            Zurück
          </button>
          {hasUsage ? (
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-muted-foreground">
                  Kosten (laufend)
                </div>
                <div className="text-lg font-bold tabular-nums">
                  {formatCHF(itemsTotal)}
                </div>
              </div>
              <Button
                className="bg-cog-teal hover:bg-cog-teal-dark"
                onClick={() =>
                  navigate({
                    to: "/checkout",
                    search: kiosk ? { kiosk: "" } : {},
                  })
                }
              >
                <ShoppingCart className="h-4 w-4 mr-2" />
                Zum Checkout
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors"
              onClick={() =>
                navigate({
                  to: "/checkout",
                  search: kiosk ? { kiosk: "" } : {},
                })
              }
            >
              Check-Out
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>

        <AlertDialog
          open={!!uncheckConfirm}
          onOpenChange={(v) => {
            if (!v) setUncheckConfirm(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Werkstatt entfernen?</AlertDialogTitle>
              <AlertDialogDescription>
                Alle erfassten Einträge für diese Werkstatt werden gelöscht.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={confirmUncheckWorkshop}
              >
                Entfernen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* /visit/add/* sub-routes mount their picker Sheet here via portal */}
      <Outlet />

      {/* Touch-device-only QR scanner FAB */}
      <ScanFab />
    </>
  )
}
