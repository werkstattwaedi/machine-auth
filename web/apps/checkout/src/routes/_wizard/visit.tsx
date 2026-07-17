// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo, useEffect } from "react"
import {
  createFileRoute,
  Outlet,
  useNavigate,
} from "@tanstack/react-router"
import { useDb } from "@modules/lib/firebase-context"
import { useCollection } from "@modules/lib/firestore"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { Button } from "@modules/components/ui/button"
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
import { ArrowLeft, ArrowRight, Plus, ShoppingCart } from "lucide-react"
import { arrayRemove, arrayUnion, documentId, where } from "firebase/firestore"
import {
  catalogCollection,
  checkoutItemRef,
  checkoutRef,
} from "@modules/lib/firestore-helpers"
import {
  getSortedWorkshops,
  workshopColor,
  type CatalogItem,
  type WorkshopId,
} from "@modules/lib/workshop-config"
import { partitionMembership } from "@oww/shared"
import { WorkshopSectionWithCatalog } from "@/components/usage/workshop-section-with-catalog"
import { MembershipInlineSection } from "@/components/usage/membership-inline-section"
import { BadgeCtaHint } from "@/components/usage/badge-cta-hint"
import { ScanFab } from "@/components/qr-scanner/scan-fab"
import { useWizardContext } from "@/components/checkout/wizard-context"
import { capturePickerScrollAnchor } from "@/components/usage/picker-scroll-anchor"

export const Route = createFileRoute("/_wizard/visit")({
  component: VisitRoute,
})

// Must match the `--animate-ws-out` duration in web/modules/index.css: the
// removal state change is deferred until the exit animation has played.
const WS_EXIT_ANIMATION_MS = 160

// The wizard layout gates this route — when there's no open checkout
// it renders <NoCheckoutGate /> against a blank page instead of mounting
// VisitRoute, so we can safely assume `openCheckout` is set here.
function VisitRoute() {
  const navigate = useNavigate()
  const db = useDb()
  const { update, remove } = useFirestoreMutation()
  const ctx = useWizardContext()
  const {
    checkoutId,
    openCheckout,
    items,
    pricingConfig,
    discountLevel,
    membershipCatalogId,
    isAnonymous,
    addItem,
    updateItem,
    removeItem,
    kiosk,
  } = ctx

  // Issue #262/#263: break the Vereinsmitgliedschaft SKU out of the workshop
  // sections. Membership items get their own read-only inline section
  // (rendered first) and must not bleed into the `diverses` workshop block.
  //
  // Badge purchases used to get the same standalone treatment, but the block
  // sat right under the picker and read as too intrusive (issue #505). The
  // badge SKU is bucketed under `diverses` server-side, so it now stays in
  // `workshopItems` and simply renders as a Diverses line item — which also
  // keeps the Diverses Zwischentotal honest.
  const { membershipItems, otherItems: workshopItems } = useMemo(
    () => partitionMembership(items, { membershipCatalogId }),
    [items, membershipCatalogId],
  )
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

  // Pinned machines (issue #105): each workshop's `config/pricing
  // .pinnedMachines` lists catalog IDs to show with an always-visible hours
  // input. Resolve their catalog docs with one batched `documentId() in`
  // query so the catalog stays the source of truth for price/label/type.
  const pinnedIdsByWorkshop = useMemo(() => {
    const m = new Map<WorkshopId, string[]>()
    for (const [wsId, ws] of sortedWorkshops) {
      if (ws.pinnedMachines && ws.pinnedMachines.length > 0) {
        m.set(wsId, ws.pinnedMachines)
      }
    }
    return m
  }, [sortedWorkshops])
  const allPinnedIds = useMemo(() => {
    const unique = [...new Set([...pinnedIdsByWorkshop.values()].flat())]
    // Firestore `in` caps at 30 operands. Today there are <10 pinned
    // machines, but warn loudly if a future config exceeds the cap so the
    // dropped machines don't silently lose their hours input.
    if (unique.length > 30) {
      console.warn(
        `config/pricing pins ${unique.length} machines; only the first 30 ` +
          `render an hours input (Firestore "in" limit).`,
      )
    }
    return unique.slice(0, 30)
  }, [pinnedIdsByWorkshop])
  const { data: pinnedCatalogDocs } = useCollection(
    allPinnedIds.length > 0 ? catalogCollection(db) : null,
    ...(allPinnedIds.length > 0 ? [where(documentId(), "in", allPinnedIds)] : []),
  )
  const pinnedCatalogByWorkshop = useMemo(() => {
    const byId = new Map(pinnedCatalogDocs.map((d) => [d.id, d as CatalogItem]))
    const m = new Map<WorkshopId, CatalogItem[]>()
    for (const [wsId, ids] of pinnedIdsByWorkshop) {
      m.set(
        wsId,
        ids.map((id) => byId.get(id)).filter((c): c is CatalogItem => !!c),
      )
    }
    return m
  }, [pinnedCatalogDocs, pinnedIdsByWorkshop])

  // Membership items are excluded (issue #262/#263) so a membership purchase
  // doesn't force-select the legacy `diverses` workshop checkbox.
  const workshopsWithItems = useMemo(() => {
    const s = new Set<WorkshopId>()
    for (const item of workshopItems) {
      if (item.workshop) s.add(item.workshop as WorkshopId)
    }
    return s
  }, [workshopItems])

  const visitedWorkshops = useMemo(() => {
    const s = new Set<WorkshopId>()
    for (const ws of openCheckout?.workshopsVisited ?? []) {
      s.add(ws as WorkshopId)
    }
    return s
  }, [openCheckout?.workshopsVisited])

  // Workshops the user manually selected via the add-chips (not yet backed
  // by a stored visit). Tracked separately from
  // workshopsWithItems / visitedWorkshops so the snapshot doesn't drift
  // when items arrive after a re-mount (issue #99).
  const [manuallySelectedWorkshops, setManuallySelectedWorkshops] = useState<
    Set<WorkshopId>
  >(() => new Set())
  const [uncheckConfirm, setUncheckConfirm] = useState<WorkshopId | null>(null)
  // Workshops currently playing their exit animation (Werkstatt-Auswahl
  // handoff). A Set, not a scalar: two removals inside one 160ms window are
  // reachable (rapid taps on two × buttons), and a scalar would flip the
  // first section back to the enter animation mid-fade. Each section stays
  // mounted (invisible via `ws-out`'s forwards fill) until the backing
  // state actually drops it from the selection.
  const [removingWs, setRemovingWs] = useState<ReadonlySet<WorkshopId>>(
    () => new Set(),
  )
  const unmarkRemoving = (wsId: WorkshopId) =>
    setRemovingWs((prev) => {
      if (!prev.has(wsId)) return prev
      const next = new Set(prev)
      next.delete(wsId)
      return next
    })

  // Selection in ADD ORDER (Werkstatt-Auswahl handoff): a newly added
  // workshop mounts directly above the chip row the user just tapped. All
  // three sources already carry add-order — Firestore's arrayUnion appends,
  // item docs arrive in creation order, and JS Sets iterate in insertion
  // order — so an ordered de-duped merge preserves it. Ids without a
  // pricing-config entry are dropped (nothing to render).
  const orderedWorkshops = useMemo(() => {
    const known = new Set(sortedWorkshops.map(([wsId]) => wsId))
    const out: WorkshopId[] = []
    const push = (w: WorkshopId) => {
      if (known.has(w) && !out.includes(w)) out.push(w)
    }
    for (const w of openCheckout?.workshopsVisited ?? []) push(w as WorkshopId)
    for (const item of workshopItems) {
      if (item.workshop) push(item.workshop as WorkshopId)
    }
    for (const w of manuallySelectedWorkshops) push(w)
    return out
  }, [
    sortedWorkshops,
    openCheckout?.workshopsVisited,
    workshopItems,
    manuallySelectedWorkshops,
  ])

  const effectiveWorkshops = useMemo(
    () => new Set(orderedWorkshops),
    [orderedWorkshops],
  )

  // Chips for the not-yet-selected workshops, in config order. A workshop
  // mid-exit-animation is still in `effectiveWorkshops`, so its chip only
  // reappears (with the row-in animation) once the section is really gone.
  const remainingWorkshops = useMemo(
    () => sortedWorkshops.filter(([wsId]) => !effectiveWorkshops.has(wsId)),
    [sortedWorkshops, effectiveWorkshops],
  )

  // The exit animation is done once a workshop leaves the selection; only
  // then may its `removingWs` entry reset, otherwise the still-mounted
  // section would flip back to the enter animation and flash.
  useEffect(() => {
    setRemovingWs((prev) => {
      const stale = [...prev].filter((w) => !effectiveWorkshops.has(w))
      if (stale.length === 0) return prev
      const next = new Set(prev)
      for (const w of stale) next.delete(w)
      return next
    })
  }, [effectiveWorkshops])

  // A genuine membership-only context hides the "Werkstätten wählen" picker
  // grid and the per-workshop sections so the page is just the membership
  // block + nav (issue #263).
  //
  // Issue #362: this must NOT trigger when the visitor is actively mid-visit.
  // Buying a membership during an open checkout appends the membership SKU to
  // that same checkout; with `workshopItems.length === 0` (a selected but
  // item-less workshop, or a visit with persons only) the old gate flipped
  // `nonWorkshopOnly` true and the workshop selectors vanished — leaving no way
  // to continue the visit. Gate on the *effective* workshop selection (which
  // unions manually-selected + item-backed + visited workshops) so any active
  // workshop keeps the full picker + sections; the membership simply becomes
  // one more position in the bill.
  const nonWorkshopOnly =
    membershipItems.length > 0 &&
    workshopItems.length === 0 &&
    effectiveWorkshops.size === 0

  const addWorkshop = (wsId: WorkshopId) => {
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

  // Play the section's exit animation, then apply the actual removal. The
  // section unmounts only when `orderedWorkshops` drops the id (local state
  // and/or Firestore snapshot), so the `forwards` fill bridges any gap
  // between animation end and snapshot arrival without a flash.
  const animateOutThen = (wsId: WorkshopId, removeSelection: () => void) => {
    setRemovingWs((prev) => new Set(prev).add(wsId))
    window.setTimeout(removeSelection, WS_EXIT_ANIMATION_MS)
  }

  const requestRemoveWorkshop = (wsId: WorkshopId) => {
    // The section stays interactive during its exit animation; ignore a
    // second tap on the same × so no duplicate timer/mutation is scheduled.
    if (removingWs.has(wsId)) return
    // Sections with recorded entries confirm first (dialog); empty sections
    // remove immediately.
    if (workshopsWithItems.has(wsId)) {
      setUncheckConfirm(wsId)
      return
    }
    animateOutThen(wsId, () => {
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
          // Failure keeps the workshop selected — un-hide the section.
          .catch(() => unmarkRemoving(wsId))
      }
    })
  }

  const confirmUncheckWorkshop = () => {
    if (!uncheckConfirm || !checkoutId) return
    const wsId = uncheckConfirm
    setUncheckConfirm(null)
    animateOutThen(wsId, () => {
      // Delete everything in the workshop EXCEPT NFC items (those are
      // server-owned MaCo sessions). Pinned manual-hour items have
      // origin "manual", so they're intentionally included — keep this as an
      // `origin` check, not `!isMachineItem`, or NFC usage would be orphaned.
      const itemsToDelete = items.filter(
        (i) => i.workshop === wsId && i.origin !== "nfc",
      )
      void (async () => {
        try {
          await uncheckWorkshop.mutate(async () => {
            await Promise.all(
              itemsToDelete.map((i) =>
                remove(checkoutItemRef(db, checkoutId, i.id)),
              ),
            )
            await update(checkoutRef(db, checkoutId), {
              workshopsVisited: arrayRemove(wsId),
            })
          })
        } catch {
          // Failure keeps the workshop selected — un-hide the section.
          unmarkRemoving(wsId)
          return
        }
        setManuallySelectedWorkshops((prev) => {
          const next = new Set(prev)
          next.delete(wsId)
          return next
        })
      })()
    })
  }

  // No scroll-into-view on add: with the chips BELOW the sections
  // (Werkstatt-Auswahl handoff) a new section mounts exactly where the
  // tapped chip row was, so the auto-scroll the old top-of-page picker
  // needed (issue #99 era) would now jump away from the tap point.

  const callbacks = useMemo(
    () => ({ addItem, updateItem, removeItem }),
    [addItem, updateItem, removeItem],
  )

  return (
    <>
      <div className="flex flex-col flex-1 gap-8">
        {/* Vereinsmitgliedschaft — rendered inline with the other workshop
            sessions (issue #262/#263). A membership is purchased on /membership
            and you can't add material to it, but it carries a (×) remove
            affordance (issue #362) so a membership accidentally added during an
            open visit can be dropped without leaving the wizard. */}
        {membershipItems.length > 0 && (
          <MembershipInlineSection
            items={membershipItems}
            onRemove={removeItem}
          />
        )}

        {/* Per-workshop sections in ADD ORDER — suppressed for a
            membership-only cart (issue #262/#263). A membership SKU lives in
            the "diverses" workshop, so its workshopsVisited entry would
            otherwise render an empty Diverses section with a "Material
            hinzufügen" button. Each section animates in on mount and out on
            removal (Werkstatt-Auswahl handoff). */}
        {!nonWorkshopOnly &&
          orderedWorkshops.map((wsId) => {
            const wsConfig = pricingConfig.workshops[wsId]
            if (!wsConfig) return null
            return (
              <div
                key={wsId}
                className={
                  removingWs.has(wsId)
                    ? "animate-ws-out motion-reduce:animate-none"
                    : "animate-ws-in motion-reduce:animate-none"
                }
              >
                <WorkshopSectionWithCatalog
                  workshopId={wsId}
                  workshop={wsConfig}
                  config={pricingConfig}
                  items={workshopItems.filter((i) => i.workshop === wsId)}
                  callbacks={callbacks}
                  discountLevel={discountLevel}
                  pinnedCatalog={pinnedCatalogByWorkshop.get(wsId) ?? []}
                  checkoutId={checkoutId}
                  onRemoveWorkshop={() => requestRemoveWorkshop(wsId)}
                  // Selbstbedienungs-Badge (issue #505): the "tap a new badge
                  // on the reader" hint lives at the bottom of Diverses — the
                  // workshop the badge SKU is bucketed under — instead of in a
                  // standalone block above the sections. Kiosk-only: the tap
                  // needs the kiosk reader, and it must resolve to an
                  // identified buyer (the tap opens the purchase dialog, see
                  // BridgeNfcRouter / BadgeOfferCoordinator).
                  footerSlot={
                    wsId === "diverses" && kiosk && !isAnonymous ? (
                      <BadgeCtaHint />
                    ) : undefined
                  }
                  onAddMaterial={() => {
                    // Snapshot the page scroll before navigating so the picker
                    // can restore it — the Sheet's scroll-lock otherwise jumps
                    // /visit back to the top behind the sheet (issue #394).
                    capturePickerScrollAnchor()
                    navigate({
                      to: "/visit/add/workshop/$workshopId",
                      params: { workshopId: wsId },
                      search: kiosk ? { kiosk: "" } : {},
                      // Keep /visit's scroll: the router's default
                      // scroll-to-top races the sheet's scroll-lock and pins
                      // the background at 0 for the whole open period
                      // (issue #523).
                      resetScroll: false,
                    })
                  }}
                />
              </div>
            )
          })}

        {/* Add-chips row BELOW the sections (Werkstatt-Auswahl handoff): a
            tapped workshop mounts its section directly above this row, so
            there is no spatial disconnect. Hidden for a membership-only cart
            like the sections above (issue #262/#263). */}
        {!nonWorkshopOnly && (
          <div
            className={
              orderedWorkshops.length > 0
                ? "border-t border-dashed border-border pt-7"
                : undefined
            }
          >
            <h2 className="font-heading text-xl font-bold mb-1">
              {orderedWorkshops.length > 0
                ? "Weitere Werkstätten"
                : "Werkstätten wählen"}
            </h2>
            {remainingWorkshops.length > 0 ? (
              <>
                {/* Selecting a workshop is also how the visit is tracked
                    (workshopsVisited), so the copy asks for every workshop
                    used — not just those with billable material. */}
                <p className="text-sm text-muted-foreground mb-4">
                  Wähle alle Werkstätten, die du heute benutzt hast — auch
                  wenn keine Kosten anfallen.
                </p>
                <div className="flex flex-wrap gap-2.5">
                  {remainingWorkshops.map(([wsId, ws]) => (
                    <button
                      key={wsId}
                      type="button"
                      onClick={() => addWorkshop(wsId)}
                      className="inline-flex h-[38px] items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-white px-3.5 text-sm font-medium transition-all duration-100 hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(0,0,0,0.10)] animate-row-in motion-reduce:animate-none"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: workshopColor(wsId) }}
                      />
                      {ws.label}
                      <Plus className="h-[13px] w-[13px] opacity-55" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Alle Werkstätten ausgewählt.
              </p>
            )}
          </div>
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
                Alle erfassten Einträge für{" "}
                {(uncheckConfirm &&
                  pricingConfig.workshops[uncheckConfirm]?.label) ||
                  "diese Werkstatt"}{" "}
                werden gelöscht.
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
