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
import {
  useTokenAuth,
  type TokenUser,
  type UnregisteredBadge,
} from "@modules/lib/token-auth"
import { useBridge } from "@modules/lib/use-bridge"
import { useCollection, useDocument } from "@modules/lib/firestore"
import {
  where,
  orderBy,
  serverTimestamp,
  arrayUnion,
  Timestamp,
  type DocumentReference,
} from "firebase/firestore"
import { rpcCallable, prewarm } from "@modules/lib/rpc"
import { businessDayStart } from "@oww/shared"
import {
  userRef,
  savedPersonRef,
  savedPersonsCollection,
  catalogRef,
  catalogReferencesRef,
  checkoutRef,
  checkoutsCollection,
  checkoutItemsCollection,
  checkoutItemRef,
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
import {
  deriveVisitUsageType,
  isOwnerOnlyUsage,
  type UserType,
  type UsageType,
} from "@modules/lib/pricing"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import type { PricingModel } from "@modules/lib/workshop-config"
import {
  usePersonsState,
  type CheckoutPerson,
  type PersonsAction,
  type SavedPersonEntry,
} from "./use-checkout-state"
import { hasPreservableState } from "./kiosk-inactivity-watcher"
import { registerKioskSessionGuard } from "./kiosk-session-guard"
import type { PaymentMethod } from "@oww/shared"
import type { PaymentChoice, PaymentData } from "./payment-methods"
import { computeCheckoutCosts } from "./step-checkout"
import { withSameDayWaiver, type PricedPerson } from "./same-day-waiver"
import { runStartOver } from "./start-over"
import {
  TERMINAL_BUSY_PHASES,
  useTerminalPayment,
  type TerminalPaymentState,
} from "./use-terminal-payment"

/**
 * `closeCheckoutAndGetPayment` throws `failed-precondition` with a
 * user-facing German reason (e.g. „Maschinen wurden genutzt, aber alle
 * Personen sind als … erfasst."); the generic „Bitte erneut versuchen" would
 * hide it and is wrong advice — retrying cannot succeed (issue #628).
 * Module-level so `useAsyncMutation`'s `mutate` keeps a stable identity.
 */
const CLOSE_AND_PAY_SERVER_MESSAGE_CODES: readonly string[] = [
  "functions/failed-precondition",
]

export interface WizardContextValue {
  // ----- identification -----
  isAccountLoggedIn: boolean
  isTagIdentified: boolean
  /**
   * Kiosk session established by a badge tap — as opposed to an e-mail/SMS
   * code sign-in, which also yields a kiosk (`isTagIdentified`) session but
   * carries no token. Only a badge tap auto-starts the visit (issue #732).
   */
  identifiedByBadge: boolean
  /** First name of the identified principal, when on record. */
  identifiedFirstName: string | null
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
  /**
   * Set when the tapped badge is authentic but registered to nobody (a
   * pre-personalized self-service badge). Carries the signed purchase
   * voucher; consumed by BadgeOfferCoordinator to open the purchase dialog
   * (identified session) or park it for after sign-in (anonymous).
   */
  unregisteredBadge: UnregisteredBadge | null
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
  /** NFC-Badge catalog id (self-service badge purchase); null when unset. */
  badgeCatalogId: string | null
  // ----- mutable wizard state -----
  persons: CheckoutPerson[]
  personsDispatch: React.Dispatch<PersonsAction>
  /**
   * The visit's usage type, derived from the persons' own types (issue
   * #605, `deriveVisitUsageType`). Decides machine time and material.
   */
  visitUsageType: UsageType
  /**
   * `persons` with the same-day usage-fee waiver previewed (ADR-0050) — what
   * the Check Out summary prices. The server decides again on close.
   */
  feePersons: PricedPerson[]
  /**
   * The identified person's saved persons (issue #605), by first name;
   * empty for a guest check-in.
   */
  savedPersons: SavedPersonEntry[]
  /**
   * Save the typed-in persons ticked "Für nächstes Mal speichern" — unless
   * a saved person with the same name and user type exists — and link
   * their lines to it. Resolves to the roster with the links applied, to
   * hand to `persistPersons` (React state hasn't updated yet). Never
   * rejects: a failed save is toasted by the mutation hook and must not
   * block the check-in — that person then goes on unlinked.
   */
  saveCompanions: () => Promise<CheckoutPerson[]>
  /** Stop suggesting a saved person; rejects when the delete failed (already toasted). */
  deleteSavedPerson: (saved: SavedPersonEntry) => Promise<void>
  tip: number
  setTip: (n: number) => void
  paymentData: PaymentData | null
  totalPrice: number
  /**
   * The card chosen on step 3 (issue #750); non-null turns the Check Out
   * page into step 4 in place. Cleared by "Zurück" until the commit closes
   * the checkout.
   */
  paymentChoice: PaymentChoice | null
  setPaymentChoice: (choice: PaymentChoice | null) => void
  /** Forget a finished checkout's confirmation (the wizard left /checkout). */
  clearPayment: () => void
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
   * account menu's "Abmelden" and the anon "Von vorne beginnen" affordances.
   * A hard reload (not a soft navigate) is required: a soft nav would let
   * the rehydrate effect immediately re-populate the roster from the
   * still-open checkout.
   */
  startOver: (opts?: { startedHint?: string | null }) => Promise<void>
  /**
   * Sign in anonymously if not already signed in. Used by /checkin's
   * onAdvance so subsequent Firestore writes have a stable Firebase UID.
   */
  signInAnonymouslyIfNeeded: () => Promise<void>
  /**
   * Persist the current `persons` array to the open checkout doc, creating
   * the doc if none exists. Called from /checkin's onAdvance and the kiosk
   * "Besuch starten". The persons are written as entered — their types alone
   * make the checkout a visit or a purchase (CHK-9) — with the derived visit
   * type alongside, so the open checkout reads right before the close.
   * `persons` overrides the roster state (the result of `saveCompanions`,
   * issue #605).
   */
  persistPersons: (opts?: { persons?: CheckoutPerson[] }) => Promise<void>
  /**
   * Close the open checkout, committing `paymentMethod` with it (issue
   * #750; omitted for a CHF 0 visit), and return payment data. Called from
   * step 4's commit button. Sets paymentData on success, which turns the
   * Check Out page into the confirmation.
   */
  submitCheckout: (paymentMethod?: PaymentMethod) => Promise<PaymentData | null>
  submitting: boolean
  // ----- payment terminal (ADR-0051) -----
  /** The running or finished terminal payment; null when none was started. */
  terminal: TerminalPaymentState | null
  /** Prices an attempt and arms the terminal; a retry is another start. */
  startTerminalPayment: () => Promise<void>
  /** Stops a terminal still waiting for a card and forgets the attempt. */
  abortTerminalPayment: () => Promise<void>
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

/**
 * The wizard's tap-time answer to BridgeNfcRouter. Once this session's
 * checkout is committed (CHK-22) it is closed: the persons still held in the
 * wizard are nothing to keep, so a badge tap switches without asking (KIO-6,
 * issues #769/#752). The idle watcher keeps using the plain
 * `hasPreservableState` — the confirmation page must still time out.
 */
export function kioskSessionSnapshot(
  state: Parameters<typeof hasPreservableState>[0] & {
    identified: boolean
    committed: boolean
    holderName: string | null
    badgeTokenIds: string[]
    paymentInProgress: boolean
  },
) {
  return {
    preservable: !state.committed && hasPreservableState(state),
    identified: state.identified,
    committed: state.committed,
    holderName: state.holderName,
    badgeTokenIds: state.badgeTokenIds,
    paymentInProgress: state.paymentInProgress,
  }
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
    unregisteredBadge,
  } = useTokenAuth(picc ?? null, cmac ?? null)
  const bridge = useBridge()

  // The wizard's exit path hits billingCall (closeCheckoutAndGetPayment /
  // getPaymentQrData); warm it while the visitor is still adding items
  // (ADR-0037).
  useEffect(() => {
    prewarm(functions, "billingCall")
  }, [functions])

  const fsMutation = useFirestoreMutation()
  const { add, update, remove } = fsMutation
  const { persons, dispatch: personsDispatch } = usePersonsState()
  const [tip, setTip] = useState(0)
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null)
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice | null>(null)
  const clearPayment = useCallback(() => {
    setPaymentData(null)
    setPaymentChoice(null)
  }, [])
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
    serverMessageCodes: CLOSE_AND_PAY_SERVER_MESSAGE_CODES,
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

  // Load checkout items. Held back while a checkout create is still in
  // flight — see useCheckoutCreateLatch for why opening the listener any
  // earlier gets it refused.
  const { inFlight: checkoutCreateInFlight, run: runCheckoutCreate } =
    useCheckoutCreateLatch()
  const { data: checkoutItems } = useCollection(
    checkoutId && !checkoutCreateInFlight
      ? checkoutItemsCollection(db, checkoutId)
      : null,
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

  // Token ids of self-service badges already in the open checkout — carried
  // on the raw item docs (server-written `tokenId`, not part of
  // CheckoutItemLocal). Published through the kiosk session guard so
  // BridgeNfcRouter can turn a re-tap of an already-added badge into a toast
  // instead of a fresh purchase offer (issue #515).
  const badgeTokenIds = useMemo(
    () =>
      checkoutItems
        .map((item) => item.tokenId)
        .filter((id): id is string => typeof id === "string"),
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
  const badgeCatalogId = catalogRefs?.badge?.id ?? null

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

  // Issue #605: each person carries their own usage type; the visit's is
  // derived from them (the owner's Freiwilligengruppe / Interne Nutzung,
  // else Begleitung when everyone accompanies, else regular).
  const ownerId = identifiedUserRef?.id ?? null
  const visitUsageType = useMemo(
    () => deriveVisitUsageType(usagePersons(persons, ownerId)),
    [persons, ownerId],
  )

  // Same-day usage-fee waiver preview (issue #268, ADR-0050): the owner's
  // visits closed since the start of this visit's opening business day —
  // an earlier visit opened that day can't have closed before it. Same
  // index as the account usage page (userId, status, closedAt desc). The
  // rules let both a signed-in member and a badge (`actsAs`) session list
  // their own checkouts.
  const openedAtMs = openCheckout?.created?.toMillis?.() ?? null
  const [fallbackOpenedAt] = useState(() => Date.now())
  const openedAt = useMemo(
    () => new Date(openedAtMs ?? fallbackOpenedAt),
    [openedAtMs, fallbackOpenedAt],
  )
  const openingDayStartMs = businessDayStart(openedAt).getTime()
  const { data: closedToday } = useCollection(
    identifiedUserRef ? checkoutsCollection(db) : null,
    ...(identifiedUserRef
      ? [
          where("userId", "==", identifiedUserRef),
          where("status", "==", "closed"),
          where("closedAt", ">=", Timestamp.fromMillis(openingDayStartMs)),
          orderBy("closedAt", "desc"),
        ]
      : []),
  )
  const feePersons = useMemo(
    () => withSameDayWaiver(persons, ownerId, openedAt, closedToday, checkoutId),
    [persons, ownerId, openedAt, closedToday, checkoutId],
  )

  // Saved persons of the identified principal (account login or badge tap).
  const { data: savedPersonDocs } = useCollection(
    ownerId ? savedPersonsCollection(db, ownerId) : null,
    orderBy("firstName"),
  )
  const savedPersons = useMemo<SavedPersonEntry[]>(
    () =>
      savedPersonDocs.map((d) => ({
        id: d.id,
        firstName: d.firstName,
        lastName: d.lastName,
        userType: d.userType,
      })),
    [savedPersonDocs],
  )

  // Pre-fill primary person for logged-in users
  usePreFillPerson(identifiedUserDoc, personsDispatch, persons, prefillNonce)

  // Pre-fill primary person for tag-identified users (incl. badge switch).
  usePreFillTagPerson(
    isAccountLoggedIn ? null : tokenUser,
    personsDispatch,
    persons,
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
    const rehydrated = rehydratePersons(openCheckout, ownerId)
    personsDispatch({ type: "REPLACE_PERSONS", persons: rehydrated })
    rehydratedRef.current = openCheckout.id
  }, [openCheckout, personsDispatch, ownerId])

  // Publish "does this session hold anything worth protecting?" to the
  // module-level kiosk session guard so BridgeNfcRouter (mounted at the
  // root, outside the wizard) can ask before discarding the session on a
  // badge tap. Read through a ref so the registered getter is always
  // current without re-registering on every render.
  // Set below from the terminal hook, which needs callbacks defined later.
  const flushTerminalReportRef = useRef<() => Promise<void>>(async () => {})
  const guardStateRef = useRef({
    openCheckout: openCheckout as CheckoutDoc | null,
    checkoutId,
    pendingCheckout: false,
    items,
    persons,
    identified: false,
    committed: false,
    holderName: null as string | null,
    badgeTokenIds: [] as string[],
    paymentInProgress: false,
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
    committed: paymentData != null,
    holderName,
    badgeTokenIds,
    // Set below, once the terminal hook ran this render.
    paymentInProgress: guardStateRef.current.paymentInProgress,
  }
  useEffect(
    () =>
      registerKioskSessionGuard(() =>
        kioskSessionSnapshot(guardStateRef.current),
      ),
    [],
  )

  // Persist the current persons array to the open checkout doc.
  const persistPersons = useCallback(async (opts?: {
    persons?: CheckoutPerson[]
  }) => {
    const roster = opts?.persons ?? persons
    const personDocs = roster.map((p) => personLocalToDoc(p, db))
    // The server re-derives it at close; kept current while open because
    // it is what makes the checkout a visit or a purchase (CHK-9).
    const usageType = deriveVisitUsageType(usagePersons(roster, ownerId))
    try {
      if (openCheckout) {
        await fsMutation.update(checkoutRef(db, openCheckout.id), {
          persons: personDocs,
          usageType,
        })
      } else {
        setPendingCheckout(true)
        const callerUid = auth?.currentUser?.uid ?? null
        await runCheckoutCreate(() =>
          fsMutation.add(checkoutsCollection(db), {
            userId: identifiedUserRef ?? null,
            status: "open",
            usageType,
            created: serverTimestamp() as unknown as CheckoutDoc["created"],
            workshopsVisited: [],
            persons: personDocs,
            modifiedBy: callerUid,
            modifiedAt:
              serverTimestamp() as unknown as CheckoutDoc["modifiedAt"],
            firebaseUid: callerUid,
          } as unknown as CheckoutDoc),
        )
      }
    } catch (err) {
      // Hook already toasted + telemetered. Clear the latch and re-throw so
      // the caller can abort navigation — otherwise /checkin would advance to
      // /visit with no open checkout and flash the "Kein offener Besuch" gate.
      setPendingCheckout(false)
      throw err
    }
  }, [
    persons,
    ownerId,
    openCheckout,
    fsMutation,
    db,
    identifiedUserRef,
    auth,
    runCheckoutCreate,
  ])

  // Issue #605: keep ticked companions for next time. Called BEFORE the
  // roster is persisted, so the open checkout already records each line's
  // saved person (CHK-11). Dedupes against the saved persons and within
  // the batch.
  const saveCompanions = useCallback(async (): Promise<CheckoutPerson[]> => {
    if (!ownerId) return persons
    const links = await saveTickedCompanions(persons, savedPersons, async (data) => {
      const ref = await add(savedPersonsCollection(db, ownerId), {
        ...data,
        createdAt: serverTimestamp(),
      })
      return ref.id
    })
    for (const { personId, savedPersonId } of links) {
      personsDispatch({
        type: "UPDATE_PERSON",
        id: personId,
        updates: { savedPersonId, saveForLater: false },
      })
    }
    return applySavedLinks(persons, links)
  }, [ownerId, savedPersons, persons, add, db, personsDispatch])

  const deleteSavedPerson = useCallback(
    async (saved: SavedPersonEntry) => {
      if (!ownerId) return
      const name = `${saved.firstName} ${saved.lastName}`.trim()
      await remove(savedPersonRef(db, ownerId, saved.id), {
        successMessage: `${name} wird nicht mehr vorgeschlagen`,
      })
    },
    [ownerId, remove, db],
  )

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
  // A burst of adds on an empty cart (double-tap, a manual add racing a badge
  // auto-add) must not mint one checkout per call. The first call owns the
  // create; calls arriving before it resolves attach to the same write.
  const checkoutCreateRef = useRef<{
    promise: Promise<DocumentReference<CheckoutDoc>>
    workshop: string
  } | null>(null)
  const addItem = useCallback(
    async (item: CheckoutItemLocal) => {
      try {
        await addItemMutation.mutate(async () => {
          let coId = checkoutId
          const visited = openCheckout?.workshopsVisited ?? []
          const workshopIsNew = !visited.includes(item.workshop)
          const callerUid = auth?.currentUser?.uid ?? null
          if (!coId && checkoutCreateRef.current) {
            const owner = checkoutCreateRef.current
            coId = (await owner.promise).id
            // The owner stamped only its own workshop at create time.
            if (item.workshop !== owner.workshop) {
              await update(checkoutRef(db, coId), {
                workshopsVisited: arrayUnion(item.workshop),
              })
            }
          } else if (!coId) {
            const promise = runCheckoutCreate(() =>
              add(checkoutsCollection(db), {
                userId: identifiedUserRef ?? null,
                status: "open",
                usageType: visitUsageType,
                created: serverTimestamp(),
                workshopsVisited: [item.workshop],
                persons: persons.map((p) => personLocalToDoc(p, db)),
                modifiedBy: callerUid,
                modifiedAt: serverTimestamp(),
                firebaseUid: callerUid,
              }),
            )
            checkoutCreateRef.current = { promise, workshop: item.workshop }
            try {
              coId = (await promise).id
            } finally {
              checkoutCreateRef.current = null
            }
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
    [
      checkoutId,
      identifiedUserRef,
      visitUsageType,
      auth,
      workshopsVisitedKey,
      runCheckoutCreate,
    ],
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
    await flushTerminalReportRef.current()
    personsDispatch({ type: "RESET" })
    setTip(0)
    setPaymentData(null)
    setPaymentChoice(null)
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
  const startOver = useCallback(
    async (opts?: { startedHint?: string | null }) => {
      // The terminal's approval report must reach the server as this
      // session: once it is wiped a retry would be refused (#812).
      await flushTerminalReportRef.current()
      await runStartOver({
        signOut,
        bridgeAvailable: bridge.available,
        resetSession: bridge.resetSession,
        reload: (target) => window.location.replace(target),
        kiosk,
        startedHint: opts?.startedHint,
      })
    },
    [signOut, bridge, kiosk],
  )

  // Submit: close checkout, get payment data. Used by /checkout's commit.
  const totalPriceRef = useRef(0)
  // The close's input — roster and summary — shared by the close and the
  // terminal's prepare step (ADR-0051), which prices exactly what the close
  // would. Persists a membership's billing address first; null when that
  // write failed (already toasted).
  const buildClosePayload = useCallback(async () => {
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
      badgeCost,
      personFeesNet,
      machineCostNet,
      materialCostNet,
    } = computeCheckoutCosts({
      // With the previewed same-day waiver, as StepCheckout shows it.
      persons: feePersons,
      usageType: visitUsageType,
      items,
      config: pricingConfig,
      membershipCatalogId,
      badgeCatalogId,
    })
    // The persisted server-side `summary.materialCost` keeps membership and
    // badge bundled in (recomputeSummary buckets both SKUs under non-nfc
    // material). Splitting them out is purely a display concern (#262/#263),
    // so the submitted estimate folds them back in.
    const billedMaterialCost = materialCost + membershipCost + badgeCost
    // NET total (#284): each section after its usage-type discount, plus the
    // never-discounted membership + badge fees and the tip. rawTotal is the
    // pre-discount sum; their difference is the discountAmount stored below.
    const total =
      personFeesNet +
      machineCostNet +
      materialCostNet +
      membershipCost +
      badgeCost +
      tip
    const rawTotal = entryFees + machineCost + billedMaterialCost + tip
    totalPriceRef.current = total

    // The close overwrites the stored roster with this payload, so identity
    // must ride along — the server keeps a `userId` only when the owner or
    // the stored open roster vouches for it (issue #741).
    const personsPayload = persons.map((p) => ({
      name: `${p.firstName} ${p.lastName}`,
      email: p.email,
      userType: p.userType,
      userId: p.userId ?? null,
      // Issue #605: authoritative per person; the server derives the
      // visit's type from these.
      usageType: p.usageType,
      ...(p.savedPersonId ? { savedPersonId: p.savedPersonId } : {}),
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
    return { personsPayload, summary }
  }, [
    identifiedUserRef,
    items,
    persons,
    feePersons,
    pricingConfig,
    membershipCatalogId,
    badgeCatalogId,
    tip,
    visitUsageType,
    update,
    db,
  ])

  const terminalPayment = useTerminalPayment({ checkoutId, bridge, buildClosePayload })
  flushTerminalReportRef.current = terminalPayment.flushReport
  const { clear: clearTerminal } = terminalPayment
  guardStateRef.current.paymentInProgress =
    !!terminalPayment.terminal && TERMINAL_BUSY_PHASES.has(terminalPayment.terminal.phase)
  // The terminal's approval shows the confirmation like a commit does
  // (CHK-23), though Wallee closes the checkout only afterwards.
  if (terminalPayment.terminal?.phase === "approved") guardStateRef.current.committed = true
  // Forgetting a finished checkout forgets its terminal payment too.
  const clearPaymentAndTerminal = useCallback(() => {
    clearPayment()
    clearTerminal()
  }, [clearPayment, clearTerminal])

  const submitCheckout = useCallback(async (
    paymentMethod?: PaymentMethod,
  ): Promise<PaymentData | null> => {
    const payload = await buildClosePayload()
    if (!payload) return null
    const { personsPayload, summary } = payload

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
        persons: typeof personsPayload
        summary: typeof summary
        paymentMethod?: PaymentMethod
      },
      PaymentData
    >(functions, "billingCall", "closeCheckoutAndGetPayment")

    try {
      let data: PaymentData
      if (checkoutId) {
        data = await submit.mutate(async () => {
          const res = await closeCheckoutAndGetPayment({
            checkoutId,
            persons: personsPayload,
            summary,
            ...(paymentMethod ? { paymentMethod } : {}),
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
            persons: personsPayload,
            summary,
            ...(paymentMethod ? { paymentMethod } : {}),
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
    buildClosePayload,
    functions,
    submit,
  ])

  const value: WizardContextValue = {
    isAccountLoggedIn,
    isTagIdentified,
    identifiedByBadge: isTagIdentified && !!tokenUser?.tokenId,
    identifiedFirstName: isAccountLoggedIn
      ? identifiedUserDoc?.firstName?.trim() || null
      : isTagIdentified
        ? tokenUser?.firstName?.trim() || null
        : null,
    isAnonymous,
    identifiedUserDoc,
    identifiedUserRef,
    isMember,
    tagAuthLoading,
    tagAuthError,
    unregisteredBadge,
    openCheckout: openCheckout ?? null,
    openCheckoutLoading,
    checkoutId,
    pendingCheckout,
    items,
    pricingConfig,
    discountLevel,
    membershipCatalogId,
    badgeCatalogId,
    persons,
    personsDispatch,
    visitUsageType,
    feePersons,
    savedPersons,
    saveCompanions,
    deleteSavedPerson,
    tip,
    setTip,
    paymentData,
    totalPrice: totalPriceRef.current,
    paymentChoice,
    setPaymentChoice,
    clearPayment: clearPaymentAndTerminal,
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
    terminal: terminalPayment.terminal,
    startTerminalPayment: terminalPayment.start,
    abortTerminalPayment: terminalPayment.abort,
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
 * Latches "a checkout create is in flight" from the moment the write is
 * issued until the server acknowledges it. The provider holds the items
 * subscription while the latch is set.
 *
 * Why: Firestore's latency compensation surfaces a freshly-created checkout
 * to the open-checkout query immediately, before the create has committed.
 * The `checkouts/{id}/items` read rule does a `get()` on the parent, so a
 * listener that reaches the server in that window finds no parent and is
 * refused with permission-denied. Listener errors are terminal in the SDK:
 * every later item write still lands (writes are sequenced after the ack),
 * but the cart stays blank until a reload re-subscribes. The emulator
 * commits fast enough that this only ever shows up against real Firestore
 * (staging, 2026-09-02).
 */
export function useCheckoutCreateLatch() {
  // A count, not a flag: overlapping creates must each hold the latch until
  // their own ack, or the first to land would reopen the listener while the
  // second is still uncommitted.
  const [pending, setPending] = useState(0)
  const run = useCallback(async <T,>(create: () => Promise<T>): Promise<T> => {
    setPending((n) => n + 1)
    try {
      return await create()
    } finally {
      setPending((n) => n - 1)
    }
  }, [])
  return { inFlight: pending > 0, run }
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
    usageType: p.usageType,
  }
  if (p.savedPersonId) {
    doc.savedPersonId = p.savedPersonId
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

/**
 * The persons of an open checkout as the roster holds them. A person
 * without their own usage type (checkouts from before issue #605) takes the
 * checkout's — Freiwilligengruppe / Interne Nutzung only on the owner's
 * line while they are alone (CHK-32), everyone else on Reguläre Nutzung.
 */
export function rehydratePersons(
  checkout: Pick<CheckoutDoc, "persons" | "usageType">,
  ownerId: string | null,
): CheckoutPerson[] {
  const legacy = (checkout.usageType as UsageType | undefined) ?? "regular"
  const alone = checkout.persons.length === 1
  return checkout.persons.map((p) => {
    const isOwner = !!ownerId && p.userRef?.id === ownerId
    const fallback: UsageType =
      isOwnerOnlyUsage(legacy) && !(isOwner && alone) ? "regular" : legacy
    return personDocToLocal(p, fallback)
  })
}

export function personDocToLocal(
  p: CheckoutPersonDoc,
  fallbackUsageType: UsageType = "regular",
): CheckoutPerson {
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
    usageType: (p.usageType as UsageType | undefined) ?? fallbackUsageType,
    ...(p.savedPersonId ? { savedPersonId: p.savedPersonId } : {}),
  }
}

/** The roster as `deriveVisitUsageType` / `machineUsageBlocked` see it. */
export function usagePersons(
  persons: readonly CheckoutPerson[],
  ownerId: string | null,
): { usageType: UsageType; isOwner: boolean }[] {
  return persons.map((p) => ({
    usageType: p.usageType,
    isOwner: !!ownerId && p.userId === ownerId,
  }))
}

/**
 * Issue #605: save the typed-in persons ticked "Für nächstes Mal speichern"
 * through `addSaved` (name + user type only — never the usage type). A
 * person matching a saved one — or one saved earlier in the same batch — by
 * first name, last name and user type is not saved again but linked to it.
 * A failed save skips that person (the mutation hook toasted) and never
 * rejects: saving must not block the check-in. Returns which line now
 * belongs to which saved person.
 */
export async function saveTickedCompanions(
  persons: readonly CheckoutPerson[],
  savedPersons: readonly SavedPersonEntry[],
  addSaved: (data: Omit<SavedPersonEntry, "id">) => Promise<string>,
): Promise<{ personId: string; savedPersonId: string }[]> {
  const known = [...savedPersons]
  const links: { personId: string; savedPersonId: string }[] = []
  for (const p of persons) {
    if (!p.saveForLater || p.savedPersonId || p.userId) continue
    // Saved persons are adults or children (CHK-28).
    if (p.userType === "firma") continue
    const firstName = p.firstName.trim()
    const lastName = p.lastName.trim()
    if (!firstName || !lastName) continue
    const userType = p.userType
    const match = known.find(
      (s) =>
        sameName(s.firstName, firstName) &&
        sameName(s.lastName, lastName) &&
        s.userType === userType,
    )
    let savedPersonId = match?.id
    if (!savedPersonId) {
      try {
        savedPersonId = await addSaved({ firstName, lastName, userType })
      } catch {
        continue
      }
      known.push({ id: savedPersonId, firstName, lastName, userType })
    }
    links.push({ personId: p.id, savedPersonId })
  }
  return links
}

/** The roster with `saveTickedCompanions`' links applied. */
export function applySavedLinks(
  persons: readonly CheckoutPerson[],
  links: readonly { personId: string; savedPersonId: string }[],
): CheckoutPerson[] {
  return persons.map((p) => {
    const link = links.find((l) => l.personId === p.id)
    return link ? { ...p, savedPersonId: link.savedPersonId, saveForLater: false } : p
  })
}

/** Saved-person dedup: same name regardless of case and surrounding space. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

