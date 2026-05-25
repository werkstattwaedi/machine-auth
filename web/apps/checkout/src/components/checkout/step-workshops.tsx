// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { Checkbox } from "@modules/components/ui/checkbox"
import { useIsMobile } from "@modules/hooks/use-mobile"
import { ArrowLeft, ArrowRight } from "lucide-react"
import {
  getSortedWorkshops,
  useCatalogForWorkshop,
} from "@modules/lib/workshop-config"
import type { PricingConfig, WorkshopId, DiscountLevel } from "@modules/lib/workshop-config"
import type { CheckoutState, CheckoutAction } from "./use-checkout-state"
import { type CheckoutItemLocal, type ItemCallbacks } from "@/components/usage/inline-rows"
import { WorkshopSectionWithCatalog } from "@/components/usage/workshop-section-with-catalog"
import { MaterialPicker } from "@/components/usage/material-picker"
import { validateCheckoutItem, hasItemErrors, type ItemErrors } from "./validation"
import { serverTimestamp, type DocumentReference } from "firebase/firestore"
import { useDb, useFirebaseAuth } from "@modules/lib/firebase-context"
import {
  catalogRef,
  checkoutsCollection,
  checkoutItemsCollection,
  checkoutItemRef,
} from "@modules/lib/firestore-helpers"
import type { UserDoc } from "@modules/lib/firestore-entities"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { partitionMembership } from "@oww/shared"
import { MembershipInlineSection } from "@/components/usage/membership-inline-section"

interface StepWorkshopsProps {
  state: CheckoutState
  dispatch: React.Dispatch<CheckoutAction>
  config: PricingConfig | null
  items: CheckoutItemLocal[]
  checkoutId: string | null
  /**
   * Owning user ref, or null for the truly-anonymous flow (issue #151).
   * The anonymous flow signs the visitor into Firebase Anonymous Auth at
   * the end of step 1, so writes here also go straight to Firestore — the
   * created checkout doc has `userId: null` and the security rules allow
   * the anon principal to write items into it.
   */
  userRef: DocumentReference<UserDoc> | null
  discountLevel: DiscountLevel
  /** Vereinsmitgliedschaft catalog id (issue #262/#263); null when unset. */
  membershipCatalogId?: string | null
}

export function StepWorkshops({
  state,
  dispatch,
  config,
  items,
  checkoutId,
  userRef,
  discountLevel,
  membershipCatalogId,
}: StepWorkshopsProps) {
  const db = useDb()
  const { add, update, remove } = useFirestoreMutation()
  // ADR-0025: each item-mutation site gets its own German fallback toast +
  // telemetry context so silent failures (the legacy pattern here) become
  // a visible, actionable error.
  const addItemMutation = useAsyncMutation({
    context: "checkout.workshopsAddItem",
    errorMessage: "Eintrag konnte nicht hinzugefügt werden",
  })
  const updateItemMutation = useAsyncMutation({
    context: "checkout.workshopsUpdateItem",
    errorMessage: "Eintrag konnte nicht aktualisiert werden",
  })
  const removeItemMutation = useAsyncMutation({
    context: "checkout.workshopsRemoveItem",
    errorMessage: "Eintrag konnte nicht gelöscht werden",
  })
  const auth = useFirebaseAuth()
  const isMobile = useIsMobile()
  const sortedWorkshops = config ? getSortedWorkshops(config) : []

  // Issue #262/#263: break the Vereinsmitgliedschaft SKU out of the workshop
  // sections. Membership items get their own read-only inline section
  // (rendered first), and they must not bleed into the `diverses` workshop
  // block — otherwise the bill/summary would still group them under Diverses.
  const { membershipItems, otherItems: workshopItems } = useMemo(
    () => partitionMembership(items, { membershipCatalogId }),
    [items, membershipCatalogId],
  )
  // A membership-only cart hides the "Werkstätten wählen" picker grid and the
  // per-workshop sections so the page is just the membership block + nav
  // (Marco's "you can't add material to a membership" intuition, #263).
  const membershipOnly =
    membershipItems.length > 0 && workshopItems.length === 0

  const [itemsSubmitted, setItemsSubmitted] = useState(false)

  // The anonymous checkout flow does not (yet) have its own routes for
  // the material picker — adding public sub-routes is the broader
  // checkout-step-routes refactor flagged in #307. For now, hold the
  // picker open-state locally and render the same `MaterialPicker`
  // component the `/visit/add/*` overlays use.
  const [pickerWorkshopId, setPickerWorkshopId] = useState<WorkshopId | null>(
    null,
  )
  const { data: pickerCatalog } = useCatalogForWorkshop(pickerWorkshopId)
  const pickerWorkshop =
    pickerWorkshopId && config ? config.workshops[pickerWorkshopId] : null

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

  // Workshops that already have items (cannot be unchecked). Membership
  // items are excluded (issue #262/#263) so a membership purchase doesn't
  // force-select the `diverses` workshop checkbox.
  const workshopsWithItems = useMemo(() => {
    const s = new Set<WorkshopId>()
    for (const item of workshopItems) {
      if (item.workshop) s.add(item.workshop as WorkshopId)
    }
    return s
  }, [workshopItems])

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

  // Single Firestore write path (issue #151). Anonymous users are signed
  // in by the time they reach this step, so they hit the same lazy-create
  // flow as authenticated users — only difference is the new checkout
  // doc's `userId` is null (the security rules allow the anon principal
  // to create + write items into a null-userId doc).
  //
  // `auth.currentUser?.uid` is stamped into `modifiedBy` on the create so
  // the wizard's checkouts subscription can scope by principal — without
  // that filter, every anon session would see every other anon's open
  // cart on refresh.
  const callbacks: ItemCallbacks = useMemo(
    () => ({
      addItem: async (item: CheckoutItemLocal) => {
        try {
          await addItemMutation.mutate(async () => {
            let coId = checkoutId
            if (!coId) {
              const callerUid = auth?.currentUser?.uid ?? null
              // Issue #318: stamp the creating Firebase Auth UID on
              // every client-side create (anonymous OR signed-in) so
              // the cleanup job has a single, generally-applicable
              // join key. The rules require firebaseUid ==
              // request.auth.uid; signed-in users' UIDs never appear
              // in the expired-anon list the cleanup queries against,
              // so their checkouts are never touched.
              const coRef = await add(checkoutsCollection(db), {
                userId: userRef ?? null,
                status: "open",
                usageType: state.usageType,
                created: serverTimestamp(),
                workshopsVisited: [item.workshop],
                persons: [],
                modifiedBy: callerUid,
                modifiedAt: serverTimestamp(),
                firebaseUid: callerUid,
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
          })
        } catch {
          // Hook already toasted + reported telemetry. Re-thrown here so
          // the wrapping `mutate` semantics still apply, but at the
          // ItemCallbacks boundary we swallow so the inline-rows UI does
          // not see an unhandled rejection.
        }
      },
      updateItem: (_id: string, item: CheckoutItemLocal) => {
        if (!checkoutId) return
        // Fire-and-forget at the callback boundary; the hook handles
        // the toast + telemetry on rejection.
        void updateItemMutation
          .mutate(() =>
            update(checkoutItemRef(db, checkoutId, item.id), {
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              formInputs: item.formInputs ?? null,
            }),
          )
          .catch(() => {
            // swallow — see above
          })
      },
      removeItem: (id: string) => {
        if (!checkoutId) return
        void removeItemMutation
          .mutate(() => remove(checkoutItemRef(db, checkoutId, id)))
          .catch(() => {
            // swallow — see above
          })
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checkoutId, userRef, state.usageType, auth],
  )

  const handleCheckout = useCallback(() => {
    setItemsSubmitted(true)
    // The v5 MaterialPicker enforces validity before `addItem`, so every
    // item created in this UI is well-formed at insert time. The check
    // remains as a safety net for legacy items (added before v5, when
    // inline editing could leave a row with quantity 0). Those items now
    // block the user silently — the v5 cart has no inline error UI to fix
    // them. Workaround until we backfill: remove + re-add via the picker.
    const invalid = items.some((item) => hasItemErrors(validateCheckoutItem(item)))
    if (invalid) return
    dispatch({ type: "SET_STEP", step: 2 })
  }, [items, dispatch])

  return (
    <div className="flex flex-col flex-1 gap-8">
      {/* Workshop checkbox selector. Hidden for a membership-only cart so the
          page is just the Vereinsmitgliedschaft block + nav (issue #263). */}
      {!membershipOnly && (
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
      )}

      {/* Vereinsmitgliedschaft — rendered inline with the other workshop
          sessions (issue #262/#263). It's a read-only block: a membership is
          purchased on /membership, and you can't add material to it. */}
      {membershipItems.length > 0 && (
        <MembershipInlineSection items={membershipItems} />
      )}

      {/* Per-workshop inline sections. Membership items are filtered out of
          their (legacy) `diverses` bucket so they only appear in the
          dedicated section above (issue #262/#263). */}
      {config &&
        sortedWorkshops
          .filter(([wsId]) => selectedWorkshops.has(wsId))
          .map(([wsId, wsConfig]) => (
            <WorkshopSectionWithCatalog
              key={wsId}
              workshopId={wsId}
              workshop={wsConfig}
              config={config}
              items={workshopItems.filter((i) => i.workshop === wsId)}
              callbacks={callbacks}
              discountLevel={discountLevel}
              checkoutId={checkoutId}
              itemErrors={itemErrors}
              sectionRef={registerSectionRef(wsId)}
              onAddMaterial={() => setPickerWorkshopId(wsId)}
            />
          ))}

      {pickerWorkshopId && pickerWorkshop && config && (
        <MaterialPicker
          open
          onOpenChange={(open) => {
            if (!open) setPickerWorkshopId(null)
          }}
          scope={{
            kind: "workshop",
            workshopId: pickerWorkshopId,
            workshopLabel: pickerWorkshop.label,
          }}
          catalogItems={pickerCatalog}
          config={config}
          discountLevel={discountLevel}
          resolveWorkshop={() => pickerWorkshopId}
          onAdd={callbacks.addItem}
        />
      )}

      <div className="flex-1" />

      {/* Sticky bottom navigation */}
      <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background border-t border-border flex gap-3 justify-between">
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
