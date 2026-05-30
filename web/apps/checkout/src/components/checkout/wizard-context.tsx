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
import { useTokenAuth } from "@modules/lib/token-auth"
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
import { httpsCallable } from "firebase/functions"
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
import type { FamilyCandidate } from "./step-checkin"
import type { PaymentData } from "./payment-result"
import { computeCheckoutCosts } from "./step-checkout"

export interface WizardContextValue {
  // ----- identification -----
  isAccountLoggedIn: boolean
  isTagIdentified: boolean
  isAnonymous: boolean
  identifiedUserDoc: UserDoc | null
  identifiedUserRef: DocumentReference | null
  // ----- query results -----
  openCheckout: CheckoutDoc | null
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
  const { tokenUser, isTagAuth, tagSignOut } = useTokenAuth(
    picc ?? null,
    cmac ?? null,
  )
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
  const { data: openCheckouts } = useCollection(
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

  const discountLevel: DiscountLevel = identifiedUserDoc?.activeMembership
    ? "member"
    : "none"

  // Sync usageType from open checkout
  useEffect(() => {
    if (openCheckout?.usageType) {
      setUsageType(openCheckout.usageType as UsageType)
    }
  }, [openCheckout?.usageType])

  // Pre-fill primary person for logged-in users
  usePreFillPerson(identifiedUserDoc, personsDispatch, persons, prefillNonce)

  // Pre-fill primary person for tag-identified users
  useEffect(() => {
    if (!tokenUser || isAccountLoggedIn) return
    const primary = persons[0]
    if (!primary || primary.isPreFilled) return
    personsDispatch({
      type: "UPDATE_PERSON",
      id: primary.id,
      updates: {
        firstName: tokenUser.firstName ?? "",
        lastName: tokenUser.lastName ?? "",
        email: tokenUser.email ?? "",
        userType: (tokenUser.userType as UserType) ?? "erwachsen",
        isPreFilled: true,
        termsAccepted: true,
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenUser?.userId])

  // Family-roster quick-add (issue #209).
  const selfUserId = identifiedUserDoc?.id ?? null
  const selfRef = selfUserId ? userRef(db, selfUserId) : null
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
  const familyCandidates: FamilyCandidate[] = useMemo(() => {
    const candidates = familyMemberDocs
      .filter((m) => !claimedUserIds.has(m.id))
      .map((m) => ({
        userId: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email ?? "",
        userType: (m.userType as UserType) ?? "erwachsen",
      }))
    if (
      identifiedUserDoc &&
      familyMembership &&
      !claimedUserIds.has(identifiedUserDoc.id)
    ) {
      candidates.unshift({
        userId: identifiedUserDoc.id,
        firstName: identifiedUserDoc.firstName,
        lastName: identifiedUserDoc.lastName,
        email: identifiedUserDoc.email ?? "",
        userType: (identifiedUserDoc.userType as UserType) ?? "erwachsen",
      })
    }
    return candidates
  }, [familyMemberDocs, claimedUserIds, identifiedUserDoc, familyMembership])

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

  // Bridge the "we just wrote a checkout, listener hasn't surfaced it
  // yet" gap. /checkin's onAdvance navigates to /visit synchronously
  // after persistPersons resolves, but the onSnapshot callback only
  // fires on a later microtask — without the latch /visit would render
  // its no-checkout gate for a beat and bounce the user back.
  const [pendingCheckout, setPendingCheckout] = useState(false)
  useEffect(() => {
    if (openCheckout && pendingCheckout) setPendingCheckout(false)
  }, [openCheckout, pendingCheckout])

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
      ...(p.billingCompany
        ? {
            billingAddress: {
              company: p.billingCompany,
              street: p.billingStreet ?? "",
              zip: p.billingZip ?? "",
              city: p.billingCity ?? "",
            },
          }
        : {}),
    }))

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

    const closeCheckoutAndGetPayment = httpsCallable<
      {
        checkoutId?: string
        newCheckout?: {
          userId: string | null
          workshopsVisited: string[]
          items: {
            workshop: string
            description: string
            origin: string
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
    >(functions, "closeCheckoutAndGetPayment")

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
  ])

  const value: WizardContextValue = {
    isAccountLoggedIn,
    isTagIdentified,
    isAnonymous,
    identifiedUserDoc,
    identifiedUserRef,
    openCheckout: openCheckout ?? null,
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

// Person <-> Firestore doc converters (extracted from the old wizard).

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
  if (p.billingCompany) {
    doc.billingAddress = {
      company: p.billingCompany,
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

