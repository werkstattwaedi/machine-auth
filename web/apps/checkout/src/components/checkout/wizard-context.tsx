// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react"
import type { ReactNode } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useAuth, type UserDoc } from "@modules/lib/auth"
import { useTokenAuth, type TokenUser } from "@modules/lib/token-auth"
import { useBridge } from "@modules/lib/use-bridge"
import { useCollection, useDocument } from "@modules/lib/firestore"
import {
  where,
  orderBy,
  documentId,
  serverTimestamp,
  arrayUnion,
  type DocumentReference,
} from "firebase/firestore"
import { rpcCallable } from "@modules/lib/rpc"
import {
  userRef,
  catalogRef,
  catalogReferencesRef,
  checkoutRef,
  checkoutsCollection,
  checkoutItemsCollection,
  checkoutItemRef,
  membershipsCollection,
  usersCollection,
} from "@modules/lib/firestore-helpers"
import {
  useDb,
  useFunctions,
  useFirebaseAuth,
} from "@modules/lib/firebase-context"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import type {
  CatalogItem,
  PricingConfig,
  WorkshopId,
  DiscountLevel,
} from "@modules/lib/workshop-config"
import type {
  CheckoutDoc,
  CheckoutPersonDoc,
} from "@modules/lib/firestore-entities"
import { type UserType, type UsageType } from "@modules/lib/pricing"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import type { PricingModel } from "@modules/lib/workshop-config"
import {
  usePersonsState,
  type CheckoutPerson,
  type PersonsAction,
} from "./use-checkout-state"
import { hasPreservableState } from "./kiosk-inactivity-watcher"
import { registerKioskSessionGuard } from "./kiosk-session-guard"
import type { FamilyCandidate } from "./step-checkin"
import type { PaymentData } from "./payment-result"
import { computeCheckoutCosts } from "./step-checkout"
import { runStartOver } from "./start-over"

export interface WizardContextValue {
  // ----- identification -----
  isAccountLoggedIn: boolean
  isTagIdentified: boolean
  isAnonymous: boolean
  identifiedUserDoc: UserDoc | null
  identifiedUserRef: DocumentReference | null
  /**
   * True when the identified principal is a Vereinsmitglied, honouring BOTH
   * identification modes: an account login carries membership on the Firestore
   * user doc, a tag tap carries only the server-derived boolean on
   * `tokenUser.activeMembership` (the kiosk session is a synthetic principal
   * whose user doc is never loaded client-side). Gates the Sammelrechnung
   * payment tab and the "Vereinsmitglied" check-in badge (issue #414).
   */
  isMember: boolean
  /**
   * True while a tapped badge is being verified against the backend and the
   * Firebase session is established. The verify RPC + custom-token sign-in
   * take noticeably longer than the physical NFC read, so the wizard shows a
   * blocking overlay (TagAuthOverlay) for immediate tap feedback.
   */
  tagAuthLoading: boolean
  /** Error message when badge verification failed; null otherwise. */
  tagAuthError: string | null
  // ----- query results -----
  openCheckout: CheckoutDoc | null
  /**
   * True until the open-checkout subscription for the current principal has
   * resolved its first snapshot. TagVisitRedirect waits on this so it can
   * make a one-shot routing decision (open checkout at identification time
   * → /visit) without misreading "query still loading" as "no checkout".
   */
  openCheckoutLoading: boolean
  checkoutId: string | null
  /**
   * True while `persistPersons` has written a new checkout doc but the
   * `onSnapshot` subscription hasn't surfaced it yet. The wizard's
   * no-checkout gate honours this so /visit doesn't briefly render the
   * "Kein offener Besuch" dialog after a freshly-clicked Weiter.
   */
  pendingCheckout: boolean
  items: CheckoutItemLocal[]
  pricingConfig: PricingConfig
  discountLevel: DiscountLevel
  /** Vereinsmitgliedschaft catalog id (issue #262/#263); null when unset. */
  membershipCatalogId: string | null
  familyCandidates: FamilyCandidate[]
  // ----- mutable wizard state -----
  persons: CheckoutPerson[]
  personsDispatch: React.Dispatch<PersonsAction>
  usageType: UsageType
  setUsageType: (t: UsageType) => void
  tip: number
  setTip: (n: number) => void
  paymentData: PaymentData | null
  totalPrice: number
  // ----- search params -----
  picc?: string
  cmac?: string
  kiosk: boolean
  // ----- actions -----
  signOut: () => Promise<void>
  resetWizard: () => Promise<void>
  /**
   * Drop the current Firebase session and hard-reload to a fresh /checkin.
   * For an anonymous visitor this abandons the open checkout — orphaned for
   * the #318 cleanup job (clients can't delete checkouts) — and the next
   * /checkin mints a new anon principal. Shared primitive behind the
   * signed-in "Abmelden" and the anon "Von vorne beginnen" affordances.
   * A hard reload (not a soft navigate) is required: a soft nav would let
   * the rehydrate effect immediately re-populate the roster from the
   * still-open checkout.
   */
  startOver: () => Promise<void>
  /**
   * Sign in anonymously if not already signed in. Used by /checkin's
   * onAdvance so subsequent Firestore writes have a stable Firebase UID.
   */
  signInAnonymouslyIfNeeded: () => Promise<void>
  /**
   * Persist the current `persons` array to the open checkout doc, creating
   * the doc if none exists. Called from /checkin's onAdvance.
   */
  persistPersons: () => Promise<void>
  /**
   * Close the open checkout and return payment data. Called from /checkout's
   * submit. Sets paymentData on success; the wizard navigates to /payment.
   */
  submitCheckout: () => Promise<PaymentData | null>
  submitting: boolean
  submitError: string | null
  // ----- item callbacks (shared with picker sub-routes) -----
  addItem: (item: CheckoutItemLocal) => Promise<void>
  updateItem: (id: string, item: CheckoutItemLocal) => void
  removeItem: (id: string) => void
  /**
   * Resolve which workshop a catalog item is attributed to. Overlap-first
   * against checkout.workshopsVisited, falling back to the catalog's first
   * declared workshop.
   */
  resolveWorkshop: (catalog: CatalogItem | null) => WorkshopId
}

const WizardContext = createContext<WizardContextValue | null>(null)

export function useWizardContext(): WizardContextValue {
  const ctx = useContext(WizardContext)
  if (!ctx) {
    throw new Error(
      "useWizardContext must be used inside a /_wizard route (or its children).",
    )
  }
  return ctx
}

interface WizardProviderProps {
  picc?: string
  cmac?: string
  kiosk: boolean
  children: ReactNode
  /** Pricing config is loaded by the layout; provider only renders once it
   * resolves so child components don't need null-check it. */
  pricingConfig: PricingConfig
}

/** Join a first/last name into a display string, or null when both are
 * empty/absent (so callers can fall back to a name-less phrasing). */
function joinName(
  first?: string | null,
  last?: string | null,
): string | null {
  const name = [first, last]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ")
  return name || null
}

export function WizardProvider({
  picc,
  cmac,
  kiosk,
  pricingConfig,
  children,
}: WizardProviderProps) {
  const db = useDb()
  const functions = useFunctions()
  const navigate = useNavigate()
  const auth = useFirebaseAuth()
  const { user, userDoc, signOut, signInAnonymouslyIfNeeded } = useAuth()
  const {
    tokenUser,
    isTagAuth,
    tagSignOut,
    loading: tagAuthLoading,
    error: tagAuthError,
  } = useTokenAuth(picc ?? null, cmac ?? null)
  const bridge = useBridge()
  const fsMutation = useFirestoreMutation()
  const { add, update, remove } = fsMutation
  const { persons, dispatch: personsDispatch } = usePersonsState()
  const [usageType, setUsageType] = useState<UsageType>("regular")
  const [tip, setTip] = useState(0)
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null)
  // Bumped by resetWizard so the logged-in pre-fill effect re-seeds the
  // roster after "Neuer Besuch starten". RESET clears persons but the user
  // stays logged in (userDoc.id unchanged), so a purely userDoc-keyed effect
  // would not re-run and /checkin would show empty anonymous fields until a
  // page reload remounts the provider.
  const [prefillNonce, setPrefillNonce] = useState(0)

  // ADR-0025: route the checkout submit through useAsyncMutation so a
  // failed callable surfaces a German error toast + inline alert.
  const submit = useAsyncMutation<PaymentData>({
    context: "checkout.closeAndPay",
    errorMessage:
      "Bezahlung konnte nicht erstellt werden. Bitte erneut versuchen.",
  })

  // Per-item-callback wrappers so failures toast + telemeter.
  const addItemMutation = useAsyncMutation({
    context: "wizard.addItem",
    errorMessage: "Eintrag konnte nicht hinzugefügt werden",
  })
  const updateItemMutation = useAsyncMutation({
    context: "wizard.updateItem",
    errorMessage: "Eintrag konnte nicht aktualisiert werden",
  })
  const removeItemMutation = useAsyncMutation({
    context: "wizard.removeItem",
    errorMessage: "Eintrag konnte nicht gelöscht werden",
  })

  const isAccountLoggedIn = !!user && !!userDoc && !isTagAuth
  const isTagIdentified = isTagAuth && !!tokenUser
  const isAnonymous = !isAccountLoggedIn && !isTagIdentified
  const identifiedUserDoc = isAccountLoggedIn ? userDoc : null
  const identifiedUserRef = useMemo<DocumentReference | null>(() => {
    if (identifiedUserDoc) return userRef(db, identifiedUserDoc.id)
    if (isTagIdentified) return userRef(db, tokenUser!.userId)
    return null
  }, [db, identifiedUserDoc, isTagIdentified, tokenUser])

  // Find open checkout for the current principal.
  const anonUid = isAnonymous && user?.isAnonymous ? user.uid : null
  const { data: openCheckouts, loading: openCheckoutLoading } = useCollection(
    identifiedUserRef
      ? checkoutsCollection(db)
      : anonUid
        ? checkoutsCollection(db)
        : null,
    ...(identifiedUserRef
      ? [
          where("userId", "==", identifiedUserRef),
          where("status", "==", "open"),
        ]
      : anonUid
        ? [
            where("userId", "==", null),
            // Scope to the checkout THIS anon session created. Key on
            // `firebaseUid` (stamped from the SDK's `auth.currentUser.uid`
            // at create, write-once per the security rules) — NOT
            // `modifiedBy`, which is an audit field stamped from the
            // AuthProvider's React `user` state. That state lags the SDK, so
            // a create racing an auth transition (logout → eager-anon)
            // stamps `modifiedBy: null` and this query would never match its
            // own doc. `modifiedBy` also tracks the *last* writer, which any
            // anon session may become (rules allow any anon to edit a
            // null-userId checkout), so it isn't a stable ownership key.
            where("firebaseUid", "==", anonUid),
            where("status", "==", "open"),
          ]
        : []),
  )
  const openCheckout = openCheckouts[0] ?? null
  const checkoutId = openCheckout?.id ?? null

  // Load checkout items
  const { data: checkoutItems } = useCollection(
    checkoutId ? checkoutItemsCollection(db, checkoutId) : null,
    orderBy("created"),
  )

  const items: CheckoutItemLocal[] = useMemo(
    () =>
      checkoutItems.map((item) => ({
        id: item.id,
        workshop: item.workshop,
        description: item.description,
        origin: item.origin,
        type: item.type ?? null,
        catalogId: item.catalogId?.id ?? null,
        variantId: item.variantId ?? null,
        pricingModel: (item.pricingModel as PricingModel) ?? null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        formInputs: item.formInputs ?? undefined,
      })),
    [checkoutItems],
  )

  // Issue #262/#263: resolve the Vereinsmitgliedschaft catalog id so the
  // /visit and /checkout steps can break membership out of the Materialbezug /
  // Diverses buckets into a dedicated section. The `config/catalog-references`
  // doc is world-readable and rarely changes, so a single subscription here is
  // cheap. `null` until it loads or when no membership SKU is configured — the
  // classifier treats that as "no membership present" and the UI is unchanged.
  const { data: catalogRefs } = useDocument(catalogReferencesRef(db))
  const membershipCatalogId = catalogRefs?.membership?.id ?? null

  // For tag-tap checkout `identifiedUserDoc` is null (the kiosk session is a
  // synthetic principal), so member pricing must also honour the tag user's
  // server-derived `activeMembership` flag — otherwise members tapping their
  // tag are charged non-member item prices (issue #358).
  const discountLevel: DiscountLevel = deriveDiscountLevel(
    identifiedUserDoc,
    tokenUser,
  )

  // Same dual-principal membership signal drives the Sammelrechnung payment
  // tab and the "Vereinsmitglied" check-in badge. For a tag tap
  // `identifiedUserDoc` is null, so without the tag fallback a tapping member
  // was offered neither the monthly-bill option nor the badge (issue #414).
  const isMember = deriveIsMember(identifiedUserDoc, tokenUser)

  // Sync usageType from open checkout
  useEffect(() => {
    if (openCheckout?.usageType) {
      setUsageType(openCheckout.usageType as UsageType)
    }
  }, [openCheckout?.usageType])

  // Pre-fill primary person for logged-in users
  usePreFillPerson(identifiedUserDoc, personsDispatch, persons, prefillNonce)

  // Pre-fill primary person for tag-identified users (incl. badge switch).
  usePreFillTagPerson(
    isAccountLoggedIn ? null : tokenUser,
    personsDispatch,
    persons,
  )

  // Family-roster quick-add (issue #209, extended for tag-tap in #422).
  // Source the self principal from `identifiedUserRef`, which is set for
  // BOTH a logged-in account and a kiosk tag-tap session — the latter
  // points at `users/${tokenUser.userId}`. The membership/co-member reads
  // below are now permitted for tag sessions by the matching firestore.rules
  // `actsAs()` carve-outs, so a tapped family member sees the same roster
  // chips the logged-in owner does.
  const selfUserId = identifiedUserRef?.id ?? null
  const selfRef = identifiedUserRef
  const { data: familyMemberships } = useCollection(
    selfRef ? membershipsCollection(db) : null,
    ...(selfRef
      ? [
          where("members", "array-contains", selfRef),
          where("type", "==", "family"),
          where("status", "==", "active"),
        ]
      : []),
  )
  const familyMembership = familyMemberships[0] ?? null
  const otherMemberIds = useMemo(() => {
    if (!familyMembership || !selfUserId) return [] as string[]
    const ids = familyMembership.members
      .map((m) => m.id)
      .filter((id) => id !== selfUserId)
    return ids.slice(0, 30)
  }, [familyMembership, selfUserId])
  const { data: familyMemberDocs } = useCollection(
    otherMemberIds.length > 0 ? usersCollection(db) : null,
    where(
      documentId(),
      "in",
      otherMemberIds.length > 0 ? otherMemberIds : [""],
    ),
  )
  const claimedUserIds = useMemo(
    () => new Set(persons.map((p) => p.userId).filter(Boolean) as string[]),
    [persons],
  )
  const familyCandidates: FamilyCandidate[] = useMemo(
    () =>
      buildFamilyCandidates({
        familyMemberDocs,
        claimedUserIds,
        identifiedUserDoc,
        tokenUser,
        hasFamilyMembership: !!familyMembership,
      }),
    [
      familyMemberDocs,
      claimedUserIds,
      identifiedUserDoc,
      tokenUser,
      familyMembership,
    ],
  )

  // Rehydrate persons from open Firestore checkout doc (issue #246).
  const rehydratedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!openCheckout) {
      rehydratedRef.current = null
      return
    }
    if (rehydratedRef.current === openCheckout.id) return
    if (!openCheckout.persons || openCheckout.persons.length === 0) {
      rehydratedRef.current = openCheckout.id
      return
    }
    const rehydrated = openCheckout.persons.map((p) => personDocToLocal(p))
    personsDispatch({ type: "REPLACE_PERSONS", persons: rehydrated })
    rehydratedRef.current = openCheckout.id
  }, [openCheckout, personsDispatch])

  // Publish "does this session hold anything worth protecting?" to the
  // module-level kiosk session guard so BridgeNfcRouter (mounted at the
  // root, outside the wizard) can ask before discarding the session on a
  // badge tap. Read through a ref so the registered getter is always
  // current without re-registering on every render.
  const guardStateRef = useRef({
    openCheckout: openCheckout as CheckoutDoc | null,
    checkoutId,
    pendingCheckout: false,
    items,
    persons,
    identified: false,
    holderName: null as string | null,
  })

  // Bridge the "we just wrote a checkout, listener hasn't surfaced it
  // yet" gap. /checkin's onAdvance navigates to /visit synchronously
  // after persistPersons resolves, but the onSnapshot callback only
  // fires on a later microtask — without the latch /visit would render
  // its no-checkout gate for a beat and bounce the user back.
  const [pendingCheckout, setPendingCheckout] = useState(false)
  useEffect(() => {
    if (openCheckout && pendingCheckout) setPendingCheckout(false)
  }, [openCheckout, pendingCheckout])

  // Keep the guard snapshot current on every render; register the getter
  // once per provider mount.
  // Name of whoever currently holds the session — the signed-in account or
  // the tapped-in badge user — so the badge-switch dialog can say whose visit
  // is being parked. Null for anonymous sessions (which use the discard copy
  // and never show a name) or when no name is on record.
  const holderName = isAccountLoggedIn
    ? joinName(identifiedUserDoc?.firstName, identifiedUserDoc?.lastName)
    : isTagIdentified
      ? joinName(tokenUser?.firstName, tokenUser?.lastName)
      : null
  guardStateRef.current = {
    openCheckout: openCheckout ?? null,
    checkoutId,
    pendingCheckout,
    items,
    persons,
    // Identified = signed-in account OR authenticated badge. Drives the
    // tap-time confirmation copy/variant: an anonymous session that gets
    // discarded loses unrecoverable work (no badge to re-tap), so it needs
    // the honest, destructive dialog (issue #468).
    identified: isAccountLoggedIn || isTagIdentified,
    holderName,
  }
  useEffect(
    () =>
      registerKioskSessionGuard(() => ({
        preservable: hasPreservableState(guardStateRef.current),
        identified: guardStateRef.current.identified,
        holderName: guardStateRef.current.holderName,
      })),
    [],
  )

  // Persist the current persons array to the open checkout doc.
  const persistPersons = useCallback(async () => {
    const personDocs = persons.map((p) => personLocalToDoc(p, db))
    try {
      if (openCheckout) {
        await fsMutation.update(checkoutRef(db, openCheckout.id), {
          persons: personDocs,
        })
      } else {
        setPendingCheckout(true)
        const callerUid = auth?.currentUser?.uid ?? null
        await fsMutation.add(checkoutsCollection(db), {
          userId: identifiedUserRef ?? null,
          status: "open",
          usageType,
          created: serverTimestamp() as unknown as CheckoutDoc["created"],
          workshopsVisited: [],
          persons: personDocs,
          modifiedBy: callerUid,
          modifiedAt: serverTimestamp() as unknown as CheckoutDoc["modifiedAt"],
          firebaseUid: callerUid,
        } as unknown as CheckoutDoc)
      }
    } catch (err) {
      // Hook already toasted + telemetered. Clear the latch and re-throw so
      // the caller can abort navigation — otherwise /checkin would advance to
      // /visit with no open checkout and flash the "Kein offener Besuch" gate.
      setPendingCheckout(false)
      throw err
    }
  }, [persons, usageType, openCheckout, fsMutation, db, identifiedUserRef, auth])

  // Workshop attribution policy for non-workshop picker scopes.
  const visitedWorkshopSet = useMemo(() => {
    const s = new Set<WorkshopId>()
    if (openCheckout?.workshopsVisited) {
      for (const ws of openCheckout.workshopsVisited) s.add(ws as WorkshopId)
    }
    return s
  }, [openCheckout?.workshopsVisited])
  const resolveWorkshop = useCallback(
    (catalog: CatalogItem | null): WorkshopId => {
      if (!catalog || catalog.workshops.length === 0) {
        const first = Object.keys(pricingConfig.workshops)[0]
        return (first ?? "makerspace") as WorkshopId
      }
      const overlap = catalog.workshops.find((w) =>
        visitedWorkshopSet.has(w as WorkshopId),
      )
      return (overlap ?? catalog.workshops[0]) as WorkshopId
    },
    [pricingConfig.workshops, visitedWorkshopSet],
  )

  // Item callbacks (shared with picker sub-routes).
  const workshopsVisitedKey = openCheckout?.workshopsVisited?.join(",") ?? ""
  const addItem = useCallback(
    async (item: CheckoutItemLocal) => {
      try {
        await addItemMutation.mutate(async () => {
          let coId = checkoutId
          const visited = openCheckout?.workshopsVisited ?? []
          const workshopIsNew = !visited.includes(item.workshop)
          const callerUid = auth?.currentUser?.uid ?? null
          if (!coId) {
            const coRef = await add(checkoutsCollection(db), {
              userId: identifiedUserRef ?? null,
              status: "open",
              usageType,
              created: serverTimestamp(),
              workshopsVisited: [item.workshop],
              persons: persons.map((p) => personLocalToDoc(p, db)),
              modifiedBy: callerUid,
              modifiedAt: serverTimestamp(),
              firebaseUid: callerUid,
            })
            coId = coRef.id
          } else if (workshopIsNew) {
            await update(checkoutRef(db, coId), {
              workshopsVisited: arrayUnion(item.workshop),
            })
          }
          await add(checkoutItemsCollection(db, coId), {
            workshop: item.workshop,
            description: item.description,
            origin: item.origin,
            ...(item.type ? { type: item.type } : {}),
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
        // Hook already toasted; swallow at boundary.
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checkoutId, identifiedUserRef, usageType, auth, workshopsVisitedKey],
  )

  const updateItem = useCallback(
    (_id: string, item: CheckoutItemLocal) => {
      if (!checkoutId) return
      void updateItemMutation
        .mutate(() =>
          update(checkoutItemRef(db, checkoutId, item.id), {
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            formInputs: item.formInputs ?? null,
            // Keep the billing classification authoritative on edit (issue
            // #105). A partial update otherwise leaves a missing `type`
            // missing; spread-omit when absent so we never write a bare null.
            ...(item.type ? { type: item.type } : {}),
          }),
        )
        .catch(() => {})
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checkoutId],
  )

  const removeItem = useCallback(
    (id: string) => {
      if (!checkoutId) return
      void removeItemMutation
        .mutate(() => remove(checkoutItemRef(db, checkoutId, id)))
        .catch(() => {})
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checkoutId],
  )

  // Reset wizard: clear local state, sign out tag/anon, navigate to /checkin.
  const resetWizard = useCallback(async () => {
    personsDispatch({ type: "RESET" })
    setUsageType("regular")
    setTip(0)
    setPaymentData(null)
    // Re-run the logged-in pre-fill against the freshly RESET roster so the
    // user's identity shows on /checkin without a reload.
    setPrefillNonce((n) => n + 1)
    await tagSignOut()
    try {
      await bridge.resetSession()
    } catch (err) {
      console.error("Failed to reset bridge session:", err)
    }
    navigate({ to: "/checkin", search: kiosk ? { kiosk: "" } : {} })
  }, [personsDispatch, tagSignOut, bridge, navigate, kiosk])

  // Drop the session + hard-reload to a fresh /checkin (see WizardContextValue
  // docs). window.location.replace — NOT navigate — so the rehydrate effect
  // can't immediately re-seed the roster from the still-open checkout.
  //
  // In the kiosk (issue #415) this is also the target of the chrome "Neuer
  // Checkout" button, so it must give the *same strong wipe* as the chrome's
  // direct reset: clear the volatile Electron partition (IndexedDB + the
  // previous user's Firebase Auth) via `bridge.resetSession()` before the
  // reload. The flow lives in `runStartOver` so it's unit-testable.
  const startOver = useCallback(async () => {
    await runStartOver({
      signOut,
      bridgeAvailable: bridge.available,
      resetSession: bridge.resetSession,
      reload: (target) => window.location.replace(target),
      kiosk,
    })
  }, [signOut, bridge, kiosk])

  // Submit: close checkout, get payment data. Used by /checkout's commit.
  const totalPriceRef = useRef(0)
  const submitCheckout = useCallback(async (): Promise<PaymentData | null> => {
    // Compute the cost breakdown locally for the receipt (the server
    // recomputes authoritatively in closeCheckoutAndGetPayment). The
    // usage-type discount (issue #284) waives sections per
    // `USAGE_TYPE_DISCOUNTS`; we store RAW section amounts in the summary
    // and submit the NET total. Both this submit and StepCheckout flow
    // through `computeCheckoutCosts` so the displayed total matches.
    const {
      personFees: entryFees,
      machineCost,
      materialCost,
      membershipCost,
      personFeesNet,
      machineCostNet,
      materialCostNet,
    } = computeCheckoutCosts({
      persons,
      usageType,
      items,
      config: pricingConfig,
      membershipCatalogId,
    })
    // The persisted server-side `summary.materialCost` keeps membership
    // bundled in (recomputeSummary buckets the membership SKU under non-nfc
    // material). Splitting it out is purely a display concern (#262/#263),
    // so the submitted estimate folds it back in.
    const billedMaterialCost = materialCost + membershipCost
    // NET total (#284): each section after its usage-type discount, plus the
    // never-discounted membership fee and the tip. rawTotal is the
    // pre-discount sum; their difference is the discountAmount stored below.
    const total =
      personFeesNet + machineCostNet + materialCostNet + membershipCost + tip
    const rawTotal = entryFees + machineCost + billedMaterialCost + tip
    totalPriceRef.current = total

    const personsPayload = persons.map((p) => ({
      name: `${p.firstName} ${p.lastName}`,
      email: p.email,
      userType: p.userType,
      ...(hasBillingFields(p)
        ? {
            billingAddress: {
              company: p.billingCompany ?? "",
              street: p.billingStreet ?? "",
              zip: p.billingZip ?? "",
              city: p.billingCity ?? "",
            },
          }
        : {}),
    }))

    // A membership generates an invoice that needs a postal address. The
    // address was captured inline in the membership line item (StepCheckout)
    // and validated before submit; persist it to the member's user doc so the
    // invoice resolves it and it's remembered. The server backstop in
    // closeCheckoutAndGetPayment reads the same field.
    if (membershipCost > 0 && identifiedUserRef && persons[0]) {
      const p = persons[0]
      try {
        await update(userRef(db, identifiedUserRef.id), {
          billingAddress: {
            company: p.billingCompany?.trim() ?? "",
            street: p.billingStreet?.trim() ?? "",
            zip: p.billingZip?.trim() ?? "",
            city: p.billingCity?.trim() ?? "",
          },
        })
      } catch {
        // Hook already toasted + telemetered (ADR-0025). Abort the submit
        // like a failed RPC — without this the rejection would escape
        // submitCheckout's null-on-failure contract and surface as an
        // unhandled rejection in the route's onSubmit.
        return null
      }
    }

    // Store RAW section amounts (issue #284); the server is authoritative
    // and recomputes both net and discount.
    const summary = {
      totalPrice: total,
      entryFees,
      machineCost,
      materialCost: billedMaterialCost,
      tip,
      discountAmount: Math.round((rawTotal - total) * 100) / 100,
    }

    const closeCheckoutAndGetPayment = rpcCallable<
      {
        checkoutId?: string
        newCheckout?: {
          userId: string | null
          workshopsVisited: string[]
          items: {
            workshop: string
            description: string
            origin: string
            type?: string | null
            catalogId: string | null
            quantity: number
            unitPrice: number
            totalPrice: number
            formInputs?: { quantity: number; unit: string }[]
            pricingModel?: string | null
          }[]
        }
        usageType: string
        persons: typeof personsPayload
        summary: typeof summary
      },
      PaymentData
    >(functions, "billingCall", "closeCheckoutAndGetPayment")

    try {
      let data: PaymentData
      if (checkoutId) {
        data = await submit.mutate(async () => {
          const res = await closeCheckoutAndGetPayment({
            checkoutId,
            usageType,
            persons: personsPayload,
            summary,
          })
          return res.data
        })
      } else {
        const newCheckout = {
          userId: identifiedUserRef?.id ?? null,
          workshopsVisited: [...new Set(items.map((i) => i.workshop))],
          items: items.map((item) => ({
            workshop: item.workshop,
            description: item.description,
            origin: item.origin,
            ...(item.type ? { type: item.type } : {}),
            catalogId: item.catalogId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            ...(item.formInputs ? { formInputs: item.formInputs } : {}),
            ...(item.pricingModel ? { pricingModel: item.pricingModel } : {}),
          })),
        }
        data = await submit.mutate(async () => {
          const res = await closeCheckoutAndGetPayment({
            newCheckout,
            usageType,
            persons: personsPayload,
            summary,
          })
          return res.data
        })
      }
      setPaymentData(data)
      return data
    } catch {
      // Hook already toasted + telemetered.
      return null
    }
  }, [
    checkoutId,
    identifiedUserRef,
    items,
    persons,
    pricingConfig,
    membershipCatalogId,
    tip,
    usageType,
    functions,
    submit,
    update,
    db,
  ])

  const value: WizardContextValue = {
    isAccountLoggedIn,
    isTagIdentified,
    isAnonymous,
    identifiedUserDoc,
    identifiedUserRef,
    isMember,
    tagAuthLoading,
    tagAuthError,
    openCheckout: openCheckout ?? null,
    openCheckoutLoading,
    checkoutId,
    pendingCheckout,
    items,
    pricingConfig,
    discountLevel,
    membershipCatalogId,
    familyCandidates,
    persons,
    personsDispatch,
    usageType,
    setUsageType,
    tip,
    setTip,
    paymentData,
    totalPrice: totalPriceRef.current,
    picc,
    cmac,
    kiosk,
    signOut: async () => {
      await signOut()
    },
    resetWizard,
    startOver,
    signInAnonymouslyIfNeeded,
    persistPersons,
    submitCheckout,
    submitting: submit.loading,
    submitError: submit.error?.message ?? null,
    addItem,
    updateItem,
    removeItem,
    resolveWorkshop,
  }

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>
}

/**
 * Resolve the item-pricing tier for the wizard from whichever principal is
 * identified. A member is charged the "member" tier; everyone else "none".
 *
 * Both inputs are honoured because the two identification modes surface
 * membership differently: an account login exposes it on the Firestore user
 * doc (`identifiedUserDoc.activeMembership`), while a tag tap carries only the
 * server-derived boolean on `tokenUser.activeMembership` (the kiosk session is
 * a synthetic principal whose user doc is never loaded client-side). Missing
 * the tag path here is what charged tag-auth members non-member prices —
 * issue #358.
 *
 * Exported for unit testing (see wizard-discount-level.test.ts).
 */
export function deriveDiscountLevel(
  identifiedUserDoc: UserDoc | null,
  tokenUser: TokenUser | null,
): DiscountLevel {
  return deriveIsMember(identifiedUserDoc, tokenUser) ? "member" : "none"
}

/**
 * True when either identified principal is a Vereinsmitglied.
 *
 * Both inputs are honoured for the same reason as `deriveDiscountLevel`: an
 * account login exposes membership on the Firestore user doc
 * (`identifiedUserDoc.activeMembership`), while a tag tap carries only the
 * server-derived boolean on `tokenUser.activeMembership` (the kiosk session is
 * a synthetic principal whose user doc is never loaded client-side). Missing
 * the tag path here is what hid the Sammelrechnung payment tab and the
 * "Vereinsmitglied" check-in badge from tag-tapping members — issue #414.
 *
 * Exported for unit testing (see wizard-discount-level.test.ts).
 */
export function deriveIsMember(
  identifiedUserDoc: UserDoc | null,
  tokenUser: TokenUser | null,
): boolean {
  return !!(
    identifiedUserDoc?.activeMembership || tokenUser?.activeMembership
  )
}

/**
 * Build the family quick-add chip list (issue #209, extended for tag-tap in
 * #422). The roster co-members come from `familyMemberDocs`; the identified
 * principal is prepended so they can re-add themselves after removing their
 * own chip.
 *
 * The self chip is sourced from the account user doc when logged in, or from
 * `tokenUser` for a kiosk tag-tap session — in the tag case
 * `identifiedUserDoc` is null but the synthetic session still identifies a
 * real family member, and the matching firestore.rules `actsAs()` carve-outs
 * now let that session read the roster docs (issue #422). Candidates already
 * on the visit (`claimedUserIds`) are filtered out.
 *
 * Exported (pure) for unit testing — see wizard-family-candidates.test.ts.
 */
export function buildFamilyCandidates({
  familyMemberDocs,
  claimedUserIds,
  identifiedUserDoc,
  tokenUser,
  hasFamilyMembership,
}: {
  familyMemberDocs: {
    id: string
    firstName: string
    lastName: string
    email?: string | null
    userType?: string | null
  }[]
  claimedUserIds: Set<string>
  identifiedUserDoc: UserDoc | null
  tokenUser: TokenUser | null
  hasFamilyMembership: boolean
}): FamilyCandidate[] {
  const candidates: FamilyCandidate[] = familyMemberDocs
    .filter((m) => !claimedUserIds.has(m.id))
    .map((m) => ({
      userId: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      email: m.email ?? "",
      userType: (m.userType as UserType) ?? "erwachsen",
    }))
  const self: FamilyCandidate | null = identifiedUserDoc
    ? {
        userId: identifiedUserDoc.id,
        firstName: identifiedUserDoc.firstName,
        lastName: identifiedUserDoc.lastName,
        email: identifiedUserDoc.email ?? "",
        userType: (identifiedUserDoc.userType as UserType) ?? "erwachsen",
      }
    : tokenUser
      ? {
          userId: tokenUser.userId,
          firstName: tokenUser.firstName ?? "",
          lastName: tokenUser.lastName ?? "",
          email: tokenUser.email ?? "",
          userType: (tokenUser.userType as UserType) ?? "erwachsen",
        }
      : null
  if (self && hasFamilyMembership && !claimedUserIds.has(self.userId)) {
    candidates.unshift(self)
  }
  return candidates
}

/**
 * Pre-fill the primary person card with data from an identified user doc.
 * Exported for unit testing the reset re-trigger (see wizard-prefill.test.tsx).
 */
export function usePreFillPerson(
  userDoc: UserDoc | null,
  dispatch: React.Dispatch<PersonsAction>,
  persons: CheckoutPerson[],
  // Re-runs the pre-fill when bumped (resetWizard) even though userDoc.id is
  // unchanged. Deliberately NOT keyed on `persons` itself — that would
  // re-inject the logged-in user into a fresh empty slot the moment they
  // remove themselves and start adding a guest.
  resetNonce: number,
) {
  useEffect(() => {
    if (!userDoc) return
    if (persons.some((p) => p.userId === userDoc.id)) return
    const target = persons.find((p) => !p.isPreFilled && !p.userId)
    if (!target) return
    dispatch({
      type: "UPDATE_PERSON",
      id: target.id,
      updates: {
        firstName: userDoc.firstName,
        lastName: userDoc.lastName,
        email: userDoc.email ?? "",
        userType: (userDoc.userType as UserType) ?? "erwachsen",
        isPreFilled: true,
        termsAccepted: !!userDoc.termsAcceptedAt,
        userId: userDoc.id,
        billingCompany: userDoc.billingAddress?.company ?? "",
        billingStreet: userDoc.billingAddress?.street ?? "",
        billingZip: userDoc.billingAddress?.zip ?? "",
        billingCity: userDoc.billingAddress?.city ?? "",
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userDoc?.id, resetNonce])
}

/**
 * Pre-fill the primary person card from a tag-identified user, and — for
 * issue #420 — replace it when a *different* badge is tapped while one is
 * already pre-filled.
 *
 * The effect is keyed on `tokenUser?.userId`, so it re-runs whenever a new
 * badge is verified. The old inline guard bailed on `primary.isPreFilled`,
 * which swallowed the switch and left the first badge's name on the card —
 * combined with the double-verify bug (now fixed in bridge-nfc-router) this
 * produced the "reading the badge has no effect after switching" symptom.
 *
 * Overwrite policy:
 *   - primary not pre-filled (empty or anon-typed): fill it — the badge tap
 *     identifies the user and supersedes anonymous input (unchanged behaviour).
 *   - primary pre-filled by THIS same tag user: idempotent re-run, skip.
 *   - primary pre-filled by a DIFFERENT tag user (badge switch): overwrite.
 *   - primary pre-filled but NOT by us (logged-in pre-fill or a roster
 *     rehydrated from an open checkout — `prefilledTagUserIdRef === null`):
 *     left intact, never discarded.
 *
 * Exported for unit testing (see wizard-prefill-tag.test.tsx).
 */
export function usePreFillTagPerson(
  tokenUser: TokenUser | null,
  dispatch: React.Dispatch<PersonsAction>,
  persons: CheckoutPerson[],
) {
  // Tracks which tag user the primary card currently reflects, so a re-run
  // for the same badge is a no-op while a switch to a new badge overwrites.
  const prefilledTagUserIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!tokenUser) return
    const primary = persons[0]
    if (!primary) return
    // Same tag user already on the card — nothing to do.
    if (
      primary.isPreFilled &&
      prefilledTagUserIdRef.current === tokenUser.userId
    ) {
      return
    }
    // A pre-filled primary we didn't fill from a tag (logged-in pre-fill or
    // rehydrated open checkout) is left intact — only tag-driven fills are
    // ours to overwrite.
    if (primary.isPreFilled && prefilledTagUserIdRef.current === null) return
    prefilledTagUserIdRef.current = tokenUser.userId
    dispatch({
      type: "UPDATE_PERSON",
      id: primary.id,
      updates: {
        firstName: tokenUser.firstName ?? "",
        lastName: tokenUser.lastName ?? "",
        email: tokenUser.email ?? "",
        userType: (tokenUser.userType as UserType) ?? "erwachsen",
        isPreFilled: true,
        termsAccepted: true,
        // Identity link (issue #457): without userId the check-in page
        // renders the editable "Person 1" card (the IdentityStrip requires
        // `isPreFilled && userId`), and the persisted checkout person lacks
        // its userRef — so the tag user's identity appeared lost.
        userId: tokenUser.userId,
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenUser?.userId])
}

// Person <-> Firestore doc converters (extracted from the old wizard).

/**
 * A person carries a billing address worth persisting when ANY billing field
 * is set — not just the company. Gating on `billingCompany` alone dropped a
 * regular member's street/zip/city on the persist→rehydrate round-trip, so
 * the membership address pre-filled from the profile never survived.
 */
export function hasBillingFields(p: CheckoutPerson): boolean {
  return !!(p.billingCompany || p.billingStreet || p.billingZip || p.billingCity)
}

export function personLocalToDoc(
  p: CheckoutPerson,
  db: ReturnType<typeof useDb>,
): CheckoutPersonDoc {
  const doc: CheckoutPersonDoc = {
    name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
    email: p.email ?? "",
    userType: p.userType,
  }
  if (p.userId) {
    doc.userRef = userRef(db, p.userId)
  }
  if (hasBillingFields(p)) {
    doc.billingAddress = {
      company: p.billingCompany ?? "",
      street: p.billingStreet ?? "",
      zip: p.billingZip ?? "",
      city: p.billingCity ?? "",
    }
  }
  return doc
}

export function personDocToLocal(p: CheckoutPersonDoc): CheckoutPerson {
  const name = (p.name ?? "").trim()
  const spaceIdx = name.indexOf(" ")
  const firstName = spaceIdx >= 0 ? name.slice(0, spaceIdx) : name
  const lastName = spaceIdx >= 0 ? name.slice(spaceIdx + 1).trim() : ""
  const userId = p.userRef?.id ?? null
  return {
    id: crypto.randomUUID(),
    firstName,
    lastName,
    email: p.email ?? "",
    userType: p.userType,
    isPreFilled: true,
    termsAccepted: true,
    userId,
    billingCompany: p.billingAddress?.company ?? "",
    billingStreet: p.billingAddress?.street ?? "",
    billingZip: p.billingAddress?.zip ?? "",
    billingCity: p.billingAddress?.city ?? "",
  }
}

