// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { Checkbox } from "@modules/components/ui/checkbox"
import { useIsMobile } from "@modules/hooks/use-mobile"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { getSortedWorkshops } from "@modules/lib/workshop-config"
import type { PricingConfig, WorkshopId, DiscountLevel } from "@modules/lib/workshop-config"
import type { CheckoutState, CheckoutAction } from "./use-checkout-state"
import { type CheckoutItemLocal, type ItemCallbacks } from "@/components/usage/inline-rows"
import { WorkshopSectionWithCatalog } from "@/components/usage/workshop-section-with-catalog"
import { validateCheckoutItem, hasItemErrors, type ItemErrors } from "./validation"
import { serverTimestamp, type DocumentReference } from "firebase/firestore"
import { useDb } from "@modules/lib/firebase-context"
import {
  catalogRef,
  checkoutsCollection,
  checkoutItemsCollection,
  checkoutItemRef,
} from "@modules/lib/firestore-helpers"
import type { UserDoc } from "@modules/lib/firestore-entities"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"

interface StepWorkshopsProps {
  state: CheckoutState
  dispatch: React.Dispatch<CheckoutAction>
  isAnonymous: boolean
  config: PricingConfig | null
  items: CheckoutItemLocal[]
  checkoutId: string | null
  userRef: DocumentReference<UserDoc> | null
  discountLevel: DiscountLevel
}

export function StepWorkshops({
  state,
  dispatch,
  isAnonymous,
  config,
  items,
  checkoutId,
  userRef,
  discountLevel,
}: StepWorkshopsProps) {
  const db = useDb()
  const { add, update, remove } = useFirestoreMutation()
  const isMobile = useIsMobile()
  const sortedWorkshops = config ? getSortedWorkshops(config) : []

  const [itemsSubmitted, setItemsSubmitted] = useState(false)

  // Recompute errors reactively so fixing an item clears its error
  const itemErrors = useMemo(() => {
    if (!itemsSubmitted) return {} as Record<string, ItemErrors>
    const errors: Record<string, ItemErrors> = {}
    for (const item of items) {
      const err = validateCheckoutItem(item)
      if (hasItemErrors(err)) errors[item.id] = err
    }
    return errors
  }, [items, itemsSubmitted])

  // Reset submitted state when items are added so new items start clean
  const prevItemCount = useRef(items.length)
  useEffect(() => {
    if (items.length > prevItemCount.current) {
      setItemsSubmitted(false)
    }
    prevItemCount.current = items.length
  }, [items.length])

  // Workshops that already have items (cannot be unchecked)
  const workshopsWithItems = useMemo(() => {
    const s = new Set<WorkshopId>()
    for (const item of items) {
      if (item.workshop) s.add(item.workshop as WorkshopId)
    }
    return s
  }, [items])

  // Track checkbox toggles explicitly made by the user. Workshops that already
  // have items are always considered selected (derived below); keeping manual
  // selections separate avoids snapshot drift when `items` arrives late (e.g.
  // after a StepWorkshops re-mount triggered by `checkoutId` changing when the
  // first item is added). See issue #99.
  const [manuallySelectedWorkshops, setManuallySelectedWorkshops] = useState<
    Set<WorkshopId>
  >(() => new Set<WorkshopId>())

  const selectedWorkshops = useMemo(() => {
    const combined = new Set<WorkshopId>(manuallySelectedWorkshops)
    for (const wsId of workshopsWithItems) combined.add(wsId)
    return combined
  }, [manuallySelectedWorkshops, workshopsWithItems])

  const toggleWorkshop = (wsId: WorkshopId) => {
    if (workshopsWithItems.has(wsId)) return
    setManuallySelectedWorkshops((prev) => {
      const next = new Set(prev)
      if (next.has(wsId)) {
        next.delete(wsId)
      } else {
        next.add(wsId)
      }
      return next
    })
  }

  // Scroll the most recently added workshop section into view so users on
  // mobile see the new inline section instead of it silently appearing below
  // the fold. See issue #100.
  //
  // We track which workshops were selected on the *previous* render and, when
  // exactly one new workshop has been added, scroll its section after the
  // browser has had a chance to paint (one rAF tick). The initial set of
  // already-selected workshops (from `workshopsWithItems` on first mount) is
  // captured in the ref so their mount doesn't trigger a scroll.
  const sectionRefs = useRef<Map<WorkshopId, HTMLDivElement>>(new Map())
  const registerSectionRef = useCallback(
    (wsId: WorkshopId) => (el: HTMLDivElement | null) => {
      if (el) sectionRefs.current.set(wsId, el)
      else sectionRefs.current.delete(wsId)
    },
    [],
  )
  const prevSelectedRef = useRef<Set<WorkshopId>>(selectedWorkshops)
  useEffect(() => {
    const prev = prevSelectedRef.current
    const added: WorkshopId[] = []
    for (const wsId of selectedWorkshops) {
      if (!prev.has(wsId)) added.push(wsId)
    }
    prevSelectedRef.current = selectedWorkshops
    if (added.length !== 1) return
    const wsId = added[0]
    const raf = requestAnimationFrame(() => {
      const el = sectionRefs.current.get(wsId)
      el?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
    return () => cancelAnimationFrame(raf)
  }, [selectedWorkshops])

  // Callbacks: local state for anonymous, Firestore for authenticated
  const callbacks: ItemCallbacks = useMemo(
    () => {
      if (isAnonymous) {
        return {
          addItem: (item: CheckoutItemLocal) => dispatch({ type: "ADD_LOCAL_ITEM", item }),
          updateItem: (_id: string, item: CheckoutItemLocal) => dispatch({ type: "UPDATE_LOCAL_ITEM", id: item.id, item }),
          removeItem: (id: string) => dispatch({ type: "REMOVE_LOCAL_ITEM", id }),
        }
      }
      return {
        addItem: async (item: CheckoutItemLocal) => {
          let coId = checkoutId
          if (!coId && userRef) {
            const coRef = await add(checkoutsCollection(db), {
              userId: userRef,
              status: "open",
              usageType: state.usageType,
              created: serverTimestamp(),
              workshopsVisited: [item.workshop],
              persons: [],
            })
            coId = coRef.id
          }
          if (!coId) return
          await add(checkoutItemsCollection(db, coId), {
            workshop: item.workshop,
            description: item.description,
            origin: item.origin,
            catalogId: item.catalogId ? catalogRef(db, item.catalogId) : null,
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
          update(checkoutItemRef(db, checkoutId, item.id), {
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            formInputs: item.formInputs ?? null,
          })
        },
        removeItem: (id: string) => {
          if (!checkoutId) return
          remove(checkoutItemRef(db, checkoutId, id))
        },
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAnonymous, checkoutId, userRef, state.usageType, dispatch],
  )

  const handleCheckout = useCallback(() => {
    setItemsSubmitted(true)
    const invalid = items.some((item) => hasItemErrors(validateCheckoutItem(item)))
    if (invalid) return
    dispatch({ type: "SET_STEP", step: 2 })
  }, [items, dispatch])

  return (
    <div className="flex flex-col flex-1 gap-8">
      {/* Workshop checkbox selector */}
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
            // Column-first order: balanced columns (e.g. 4-3-3 for 10 items in 3 cols)
            const cols = isMobile ? 2 : 3
            const n = sortedWorkshops.length
            const rows = Math.ceil(n / cols)
            const fullCols = n - (rows - 1) * cols // columns with `rows` items
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
              <label key={wsId} className={`flex items-center gap-2 ${hasItems ? "cursor-default" : "cursor-pointer"}`} style={{ order }}>
                <Checkbox
                  checked={selectedWorkshops.has(wsId)}
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
      {config &&
        sortedWorkshops
          .filter(([wsId]) => selectedWorkshops.has(wsId))
          .map(([wsId, wsConfig]) => (
            <WorkshopSectionWithCatalog
              key={wsId}
              workshopId={wsId}
              workshop={wsConfig}
              config={config}
              items={items.filter((i) => i.workshop === wsId)}
              callbacks={callbacks}
              discountLevel={discountLevel}
              checkoutId={checkoutId}
              itemErrors={itemErrors}
              sectionRef={registerSectionRef(wsId)}
            />
          ))}

      <div className="flex-1" />

      {/* Sticky bottom navigation */}
      <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background border-t border-border flex gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-cog-teal border border-cog-teal rounded-[3px] bg-white hover:bg-cog-teal-light transition-colors"
          onClick={() => dispatch({ type: "SET_STEP", step: 0 })}
        >
          <ArrowLeft className="h-4 w-4" />
          Zurück
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors"
          onClick={handleCheckout}
        >
          Check-Out
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
