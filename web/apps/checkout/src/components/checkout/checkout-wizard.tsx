// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useEffect, useRef, useMemo } from "react"
import { useAuth } from "@modules/lib/auth"
import { useTokenAuth } from "@modules/lib/token-auth"
import { useCollection } from "@modules/lib/firestore"
import { where, orderBy } from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import {
  userRef,
  checkoutsCollection,
  checkoutItemsCollection,
} from "@modules/lib/firestore-helpers"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { usePricingConfig } from "@modules/lib/workshop-config"
import { calculateFee } from "@modules/lib/pricing"
import { PageLoading } from "@modules/components/page-loading"
import { EmptyState } from "@modules/components/empty-state"
import { AlertTriangle } from "lucide-react"
import { CheckoutProgress } from "./checkout-progress"
import { StepCheckin } from "./step-checkin"
import { StepWorkshops } from "./step-workshops"
import { StepCheckout } from "./step-checkout"
import { PaymentResult, type PaymentData } from "./payment-result"
import {
  useCheckoutState,
  type CheckoutAction,
} from "./use-checkout-state"
import type { UserType, UsageType } from "@modules/lib/pricing"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import type { PricingModel } from "@modules/lib/workshop-config"

interface CheckoutWizardProps {
  picc?: string
  cmac?: string
  kiosk?: boolean
  initialStep?: number
  onActiveChange?: (active: boolean) => void
}

export function CheckoutWizard({ picc, cmac, kiosk, initialStep, onActiveChange }: CheckoutWizardProps) {
  const db = useDb()
  const functions = useFunctions()
  const { user, userDoc, signOut, signInAnonymouslyIfNeeded } = useAuth()
  const { tokenUser, loading: tokenLoading, isTagAuth, tagSignOut } = useTokenAuth(
    picc ?? null,
    cmac ?? null,
  )
  const { state, dispatch } = useCheckoutState(initialStep)
  const [submitting, setSubmitting] = useState(false)
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null)
  const { data: pricingConfig, loading: loadingConfig, configError } = usePricingConfig()
  // Set true after the first render that gets past the initial loading
  // gate. Used so subsequent intermediate loading states (e.g. the items
  // subscription detaching/re-attaching when `checkoutId` flips) don't
  // bounce the user back to <PageLoading /> — that would unmount
  // StepWorkshops and erase its in-component state. Issue #151.
  const hasRenderedRef = useRef(false)

  // Determine auth mode (tag-auth signs into Firebase Auth too, but is not
  // an "account login" — it should still behave like a kiosk session with
  // timeouts and sign-out on close)
  const isAccountLoggedIn = !!user && !!userDoc && !isTagAuth
  const isTagIdentified = isTagAuth && !!tokenUser
  const isAnonymous = !isAccountLoggedIn && !isTagIdentified
  const identifiedUserDoc = isAccountLoggedIn ? userDoc : null
  const identifiedUserRef = identifiedUserDoc
    ? userRef(db, identifiedUserDoc.id)
    : isTagIdentified
      ? userRef(db, tokenUser!.userId)
      : undefined

  // Find open checkout for the current principal.
  //
  // Identified users (real login + tag-tap): query by `userId` reference.
  //
  // Truly anonymous users (issue #151): once they sign in anonymously at
  // the end of step 1, their session has a stable Firebase Auth UID for
  // the rest of the visit. We subscribe to open checkouts they created
  // (`modifiedBy == auth.uid`) so a refresh on step 2 reattaches to the
  // same checkout doc and the items they added persist. The Firestore
  // rule still permits all anon sessions to read any null-userId
  // checkout (doc IDs are unguessable), but the query filter scopes us
  // to our own.
  const anonUid = isAnonymous && user?.isAnonymous ? user.uid : null
  const { data: openCheckouts, loading: loadingCheckout } = useCollection(
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
            where("modifiedBy", "==", anonUid),
            where("status", "==", "open"),
          ]
        : []),
  )
  const openCheckout = openCheckouts[0] ?? null
  const checkoutId = openCheckout?.id ?? null

  // Load checkout items
  const { data: checkoutItems, loading: loadingItems } = useCollection(
    checkoutId ? checkoutItemsCollection(db, checkoutId) : null,
    orderBy("created"),
  )

  // Map to local shape
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
        formInputs: item.formInputs ?? undefined,
      })),
    [checkoutItems],
  )

  // Issue #151: anonymous users now sign in eagerly after step 1, so they
  // write items to the Firestore subcollection just like authenticated
  // users. The legacy `state.localItems` branch (and the
  // `effectiveItems = isAnonymous ? localItems : items` split) is gone.

  // Pre-fill primary person for logged-in users
  usePreFillPerson(identifiedUserDoc, dispatch, state.persons)

  // Pre-fill primary person for tag-identified users and auto-advance
  useEffect(() => {
    if (!tokenUser || isAccountLoggedIn) return
    const primary = state.persons[0]
    if (!primary || primary.isPreFilled) return

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
      },
    })
    // Intentionally keyed only on userId — re-run only when a different user's
    // tag is tapped, not on every tokenUser field update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenUser?.userId])

  // Inactivity timeout for non-logged-in users (5 minutes)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Always-current reset callback; stored in a ref so the timeout closure
  // never captures a stale dispatch reference.
  const onResetRef = useRef<(() => Promise<void>) | null>(null)
  onResetRef.current = async () => {
    dispatch({ type: "RESET" })
    await tagSignOut()
    // In the Electron kiosk app, also wipe the webview's session storage
    // so any leftover Firebase Auth state from this session is gone.
    // Defined by the kiosk preload (see checkout-kiosk/preload.js); a
    // no-op in regular browsers.
    const kioskApi = (window as unknown as { kiosk?: { resetSession?: () => Promise<void> } }).kiosk
    if (kioskApi?.resetSession) {
      try {
        await kioskApi.resetSession()
      } catch (err) {
        console.error("Failed to reset kiosk session:", err)
      }
    }
    window.history.replaceState(null, "", kiosk ? "/?kiosk" : "/")
  }

  useEffect(() => {
    // Only apply timeout to non-logged-in users with an active checkout
    if (isAccountLoggedIn) return
    const hasActivity = state.step > 0 || !!(picc && cmac)
    if (!hasActivity) return

    const resetTimeout = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        onResetRef.current?.()
      }, 5 * 60 * 1000)
    }

    resetTimeout()

    const events = ["pointerdown", "keydown", "scroll"]
    const handler = () => resetTimeout()
    events.forEach((e) => window.addEventListener(e, handler))

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      events.forEach((e) => window.removeEventListener(e, handler))
    }
  }, [isAccountLoggedIn, state.step, picc, cmac])

  // Auto-reset after submission for non-logged-in users (30s to view payment info)
  useEffect(() => {
    if (!state.submitted || isAccountLoggedIn) return
    const timer = setTimeout(() => {
      // Reuse the unified reset callback so we get the same kiosk
      // session wipe + tagSignOut + URL replace as the inactivity path.
      onResetRef.current?.()
    }, 30_000)
    return () => clearTimeout(timer)
  }, [state.submitted, isAccountLoggedIn])

  // Sign out tag auth when wizard unmounts (new tag replaces this instance)
  useEffect(() => {
    return () => { tagSignOut() }
  }, [tagSignOut])

  // Report checkout active state to parent
  const isActive = state.step > 0 || state.persons[0]?.isPreFilled
  useEffect(() => {
    onActiveChange?.(!!isActive)
  }, [isActive, onActiveChange])

  // Sync usageType from open checkout
  useEffect(() => {
    if (openCheckout?.usageType) {
      dispatch({ type: "SET_USAGE_TYPE", usageType: openCheckout.usageType as UsageType })
    }
  }, [openCheckout?.usageType, dispatch])

  // Only block on the *first* load. Once we've rendered the wizard once,
  // intermediate loading states (e.g. items subscription re-attaching when
  // `checkoutId` flips from null → "abc" after the first item write in the
  // anonymous flow — issue #151) must NOT unmount StepWorkshops; losing
  // its local state (`manuallySelectedWorkshops`) would drop the workshop
  // sections the user just selected.
  if (!hasRenderedRef.current) {
    if (tokenLoading || loadingCheckout || loadingItems || loadingConfig) {
      return <PageLoading />
    }
    hasRenderedRef.current = true
  }

  // Issue #149: refuse to render the checkout if `config/pricing` is
  // missing or malformed. The previous behaviour silently substituted
  // hardcoded fees that diverged from production prices, hiding a
  // misconfigured Firestore document until month-end reconciliation.
  if (configError || !pricingConfig) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Konfigurationsfehler"
        description={
          configError
            ? `Preiskonfiguration ungültig: ${configError}. Bitte Admin kontaktieren.`
            : "Preiskonfiguration konnte nicht geladen werden. Bitte Admin kontaktieren."
        }
      />
    )
  }

  if (state.submitted) {
    return (
      <PaymentResult
        checkoutId={state.checkoutId}
        totalPrice={state.totalPrice}
        initialPaymentData={paymentData}
        resetLabel={isAccountLoggedIn ? "Zurück zum Besuch" : undefined}
        onReset={() => {
          dispatch({ type: "RESET" })
          setPaymentData(null)
          if (isAccountLoggedIn) {
            window.location.href = "/visit"
          } else {
            tagSignOut()
            window.history.replaceState(null, "", kiosk ? "/?kiosk" : "/")
          }
        }}
      />
    )
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      // Anonymous sign-in moved to step 1 (issue #151) — by the time the
      // user reaches the checkout step they're already a Firebase
      // principal (anonymous, real, or tag), so no extra round-trip here.

      // Calculate entry fees (client-side estimate for the receipt; the
      // server recomputes authoritatively in closeCheckoutAndGetPayment).
      // pricingConfig is non-null here — render is gated by the configError
      // check above. calculateFee returns null for unknown userType+usageType
      // combinations; treat those as zero to avoid blocking the submit on a
      // misconfigured row (the server will throw and surface the error).
      const entryFees = state.persons.reduce(
        (sum, p) => sum + (calculateFee(p.userType, state.usageType, pricingConfig) ?? 0),
        0,
      )

      const nfcItems = items.filter((i) => i.origin === "nfc")
      const materialItems = items.filter((i) => i.origin !== "nfc")
      const machineCost = nfcItems.reduce((sum, i) => sum + i.totalPrice, 0)
      const materialCost = materialItems.reduce((sum, i) => sum + i.totalPrice, 0)
      const total = entryFees + machineCost + materialCost + state.tip

      const persons = state.persons.map((p) => ({
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

      const summary = {
        totalPrice: total,
        entryFees,
        machineCost,
        materialCost,
        tip: state.tip,
      }

      // One callable round-trip closes (or creates+closes) the checkout,
      // creates the bill, and returns the QR data. Replaces the old async
      // chain (Firestore write → trigger → second callable for QR), which
      // also stalled the anonymous flow because the checkouts read rule
      // requires isSignedIn().
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
          persons: typeof persons
          summary: typeof summary
        },
        PaymentData
      >(functions, "closeCheckoutAndGetPayment")

      let resultCheckoutId: string | null

      if (checkoutId) {
        const { data } = await closeCheckoutAndGetPayment({
          checkoutId,
          usageType: state.usageType,
          persons,
          summary,
        })
        setPaymentData(data)
        resultCheckoutId = checkoutId
      } else {
        // Degenerate path: user reached step 2 without ever adding an item
        // (so step-workshops never lazy-created a Firestore checkout doc).
        // Common case is "tip only" / "entry fee only". The callable
        // handles this by creating the doc server-side.
        const newCheckout = {
          // Preserve the original semantic: an account/tag user with no
          // pre-existing open checkout still gets their userId stamped on
          // the new doc. Only truly anonymous visitors send null.
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

        const { data } = await closeCheckoutAndGetPayment({
          newCheckout,
          usageType: state.usageType,
          persons,
          summary,
        })
        setPaymentData(data)
        // The callable creates the doc server-side; the client never needs
        // the new id (PaymentResult uses initialPaymentData directly).
        resultCheckoutId = null
      }

      dispatch({
        type: "SET_SUBMITTED",
        checkoutId: resultCheckoutId,
        totalPrice: total,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <CheckoutProgress currentStep={state.step} />
      {state.step === 0 && (
        <StepCheckin
          state={state}
          dispatch={dispatch}
          isAnonymous={isAnonymous}
          kiosk={!!kiosk}
          isAccountLoggedIn={isAccountLoggedIn}
          onSignOut={async () => {
            await signOut()
            window.location.replace(kiosk ? "/?kiosk" : "/")
          }}
          onAdvance={async () => {
            // Issue #151: eager anonymous sign-in. No-op for already
            // identified users (real, anonymous-already, or tag).
            if (isAnonymous) await signInAnonymouslyIfNeeded()
          }}
        />
      )}
      {state.step === 1 && (
        <StepWorkshops
          state={state}
          dispatch={dispatch}
          config={pricingConfig}
          items={items}
          checkoutId={checkoutId}
          userRef={identifiedUserRef ?? null}
          discountLevel={
            identifiedUserDoc?.roles?.includes("vereinsmitglied")
              ? "member"
              : "none"
          }
        />
      )}
      {state.step === 2 && (
        <StepCheckout
          state={state}
          dispatch={dispatch}
          onSubmit={handleSubmit}
          submitting={submitting}
          items={items}
          config={pricingConfig}
        />
      )}
    </div>
  )
}

/**
 * Pre-fill the primary person card with data from an identified user doc.
 */
function usePreFillPerson(
  userDoc: {
    id: string
    firstName: string
    lastName: string
    email?: string
    userType?: string
    termsAcceptedAt?: unknown
    billingAddress?: { company: string; street: string; zip: string; city: string } | null
  } | null,
  dispatch: React.Dispatch<CheckoutAction>,
  persons: { id: string; isPreFilled: boolean }[],
) {
  useEffect(() => {
    if (!userDoc) return
    const primary = persons[0]
    if (!primary || primary.isPreFilled) return

    dispatch({
      type: "UPDATE_PERSON",
      id: primary.id,
      updates: {
        firstName: userDoc.firstName,
        lastName: userDoc.lastName,
        email: userDoc.email ?? "",
        userType: (userDoc.userType as UserType) ?? "erwachsen",
        isPreFilled: true,
        termsAccepted: !!userDoc.termsAcceptedAt,
        billingCompany: userDoc.billingAddress?.company ?? "",
        billingStreet: userDoc.billingAddress?.street ?? "",
        billingZip: userDoc.billingAddress?.zip ?? "",
        billingCity: userDoc.billingAddress?.city ?? "",
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userDoc?.id])
}
