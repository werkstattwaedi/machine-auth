// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { ArrowLeft, ArrowRight } from "lucide-react"
import {
  getSortedWorkshops,
  useCatalogForWorkshop,
} from "@/lib/workshop-config"
import type { PricingConfig, WorkshopId, DiscountLevel } from "@/lib/workshop-config"
import type { CheckoutState, CheckoutAction } from "./use-checkout-state"
import {
  WorkshopInlineSection,
  type CheckoutItemLocal,
  type ItemCallbacks,
} from "@/components/usage/inline-rows"
import {
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  serverTimestamp,
  doc,
  type DocumentReference,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { PageLoading } from "@/components/page-loading"

interface StepWorkshopsProps {
  state: CheckoutState
  dispatch: React.Dispatch<CheckoutAction>
  isAnonymous: boolean
  config: PricingConfig | null
  items: CheckoutItemLocal[]
  checkoutId: string | null
  userRef: DocumentReference | null
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
  const sortedWorkshops = config ? getSortedWorkshops(config) : []

  // Workshops that already have items (cannot be unchecked)
  const workshopsWithItems = useMemo(() => {
    const s = new Set<WorkshopId>()
    for (const item of items) {
      if (item.workshop) s.add(item.workshop as WorkshopId)
    }
    return s
  }, [items])

  // Pre-select workshops that have items
  const [selectedWorkshops, setSelectedWorkshops] = useState<Set<WorkshopId>>(
    () => new Set<WorkshopId>(workshopsWithItems),
  )

  const toggleWorkshop = (wsId: WorkshopId) => {
    if (workshopsWithItems.has(wsId)) return
    setSelectedWorkshops((prev) => {
      const next = new Set(prev)
      if (next.has(wsId)) {
        next.delete(wsId)
      } else {
        next.add(wsId)
      }
      return next
    })
  }

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
            const coRef = await addDoc(collection(db, "checkouts"), {
              userId: userRef,
              status: "open",
              usageType: state.usageType,
              created: serverTimestamp(),
              workshopsVisited: [item.workshop],
              persons: [],
              modifiedBy: null,
              modifiedAt: serverTimestamp(),
            })
            coId = coRef.id
          }
          if (!coId) return
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
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAnonymous, checkoutId, userRef, state.usageType, dispatch],
  )

  return (
    <div className="space-y-8">
      {/* Workshop checkbox selector */}
      <div>
        <h2 className="text-xl font-bold font-body mb-2">
          Werkstätten wählen
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Für welche Werkstätten möchtest du Kosten erfassen?
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {sortedWorkshops.map(([wsId, ws]) => {
            const hasItems = workshopsWithItems.has(wsId)
            return (
              <label key={wsId} className={`flex items-center gap-2 ${hasItems ? "cursor-default" : "cursor-pointer"}`}>
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
            />
          ))}

      {/* Navigation */}
      <div className="flex gap-3">
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
          onClick={() => dispatch({ type: "SET_STEP", step: 2 })}
        >
          Check-Out
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function WorkshopSectionWithCatalog({
  workshopId,
  workshop,
  config,
  items,
  callbacks,
  discountLevel,
}: {
  workshopId: WorkshopId
  workshop: { label: string; order: number }
  config: PricingConfig
  items: CheckoutItemLocal[]
  callbacks: ItemCallbacks
  discountLevel: DiscountLevel
}) {
  const { data: rawCatalog, loading } = useCatalogForWorkshop(workshopId)

  if (loading) return <PageLoading />

  const wrappedCallbacks: ItemCallbacks = {
    ...callbacks,
    addItem: (item: CheckoutItemLocal) => {
      let resolved = item
      if (item.catalogId) {
        const cat = rawCatalog.find((c) => c.id === item.catalogId)
        if (cat) {
          resolved = { ...item, unitPrice: cat.unitPrice[discountLevel] ?? cat.unitPrice.none ?? 0 }
        }
      }
      callbacks.addItem(resolved)
    },
  }

  return (
    <WorkshopInlineSection
      workshopId={workshopId}
      workshop={workshop}
      config={config}
      items={items}
      catalogItems={rawCatalog}
      callbacks={wrappedCallbacks}
      discountLevel={discountLevel}
    />
  )
}
