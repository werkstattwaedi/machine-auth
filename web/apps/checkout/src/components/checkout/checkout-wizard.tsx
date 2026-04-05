// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useEffect, useRef, useMemo } from "react"
import { useAuth } from "@modules/lib/auth"
import { useTokenAuth } from "@modules/lib/token-auth"
import { useCollection } from "@modules/lib/firestore"
import {
  where,
  orderBy,
  addDoc,
  updateDoc,
  collection,
  serverTimestamp,
  doc,
} from "firebase/firestore"
import { userRef } from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import { usePricingConfig } from "@modules/lib/workshop-config"
import { calculateFee } from "@modules/lib/pricing"
import { PageLoading } from "@modules/components/page-loading"
import { CheckoutProgress } from "./checkout-progress"
import { StepCheckin } from "./step-checkin"
import { StepWorkshops } from "./step-workshops"
import { StepCheckout } from "./step-checkout"
import { PaymentResult } from "./payment-result"
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

interface CheckoutDoc {
  userId: { id: string }
  status: "open" | "closed"
  usageType: string
  workshopsVisited: string[]
}

interface CheckoutItemDoc {
  workshop: string
  description: string
  origin: "nfc" | "manual" | "qr"
  catalogId: { id: string } | null
  pricingModel?: string | null
  quantity: number
  unitPrice: number
  totalPrice: number
  formInputs?: { quantity: number; unit: string }[]
}

export function CheckoutWizard({ picc, cmac, kiosk, initialStep, onActiveChange }: CheckoutWizardProps) {
  const db = useDb()
  const { user, userDoc, signOut } = useAuth()
  const { tokenUser, loading: tokenLoading, isTagAuth, tagSignOut } = useTokenAuth(
    picc ?? null,
    cmac ?? null,
  )
  const { state, dispatch } = useCheckoutState(initialStep)
  const [submitting, setSubmitting] = useState(false)
  const { data: pricingConfig, loading: loadingConfig } = usePricingConfig()

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

  // Find open checkout for identified user
  const { data: openCheckouts, loading: loadingCheckout } =
    useCollection<CheckoutDoc>(
      identifiedUserRef ? "checkouts" : null,
      ...(identifiedUserRef
        ? [
            where("userId", "==", identifiedUserRef),
            where("status", "==", "open"),
          ]
        : []),
    )
  const openCheckout = openCheckouts[0] ?? null
  const checkoutId = openCheckout?.id ?? null

  // Load checkout items
  const { data: checkoutItems, loading: loadingItems } =
    useCollection<CheckoutItemDoc>(
      checkoutId ? `checkouts/${checkoutId}/items` : null,
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
        formInputs: item.formInputs,
      })),
    [checkoutItems],
  )

  // Merge Firestore items with local items (for anonymous users)
  const effectiveItems = isAnonymous ? state.localItems : items

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
  const onResetRef = useRef<(() => void) | null>(null)
  onResetRef.current = () => {
    dispatch({ type: "RESET" })
    tagSignOut()
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
      dispatch({ type: "RESET" })
      tagSignOut()
      window.history.replaceState(null, "", kiosk ? "/?kiosk" : "/")
    }, 30_000)
    return () => clearTimeout(timer)
  }, [state.submitted, isAccountLoggedIn, dispatch, kiosk, tagSignOut])

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

  if (tokenLoading || loadingCheckout || loadingItems || loadingConfig) {
    return <PageLoading />
  }

  if (state.submitted) {
    return (
      <PaymentResult
        totalPrice={state.totalPrice}
        onReset={() => {
          dispatch({ type: "RESET" })
          tagSignOut()
        }}
      />
    )
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      // Calculate entry fees
      const entryFees = state.persons.reduce(
        (sum, p) => sum + calculateFee(p.userType, state.usageType, pricingConfig),
        0,
      )

      const nfcItems = effectiveItems.filter((i) => i.origin === "nfc")
      const materialItems = effectiveItems.filter((i) => i.origin !== "nfc")
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

      if (checkoutId) {
        // Close existing open checkout
        await updateDoc(doc(db, "checkouts", checkoutId), {
          status: "closed",
          usageType: state.usageType,
          persons,
          closedAt: serverTimestamp(),
          notes: null,
          summary,
          modifiedBy: user?.uid ?? null,
          modifiedAt: serverTimestamp(),
        })

        dispatch({
          type: "SET_SUBMITTED",
          checkoutId,
          totalPrice: total,
        })
      } else {
        // Anonymous checkout — create closed checkout in one shot
        const checkoutDocRef = await addDoc(collection(db, "checkouts"), {
          userId: identifiedUserRef ?? null,
          status: "closed",
          usageType: state.usageType,
          created: serverTimestamp(),
          workshopsVisited: [...new Set(effectiveItems.map((i) => i.workshop))],
          persons,
          closedAt: serverTimestamp(),
          notes: null,
          summary,
          modifiedBy: user?.uid ?? null,
          modifiedAt: serverTimestamp(),
        })

        // Create items in subcollection for anonymous
        for (const item of effectiveItems) {
          await addDoc(
            collection(db, "checkouts", checkoutDocRef.id, "items"),
            {
              workshop: item.workshop,
              description: item.description,
              origin: item.origin,
              catalogId: item.catalogId
                ? doc(db, "catalog", item.catalogId)
                : null,
              created: serverTimestamp(),
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              formInputs: item.formInputs ?? null,
            },
          )
        }

        dispatch({
          type: "SET_SUBMITTED",
          checkoutId: checkoutDocRef.id,
          totalPrice: total,
        })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
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
        />
      )}
      {state.step === 1 && (
        <StepWorkshops
          state={state}
          dispatch={dispatch}
          isAnonymous={isAnonymous}
          config={pricingConfig}
          items={effectiveItems}
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
          items={effectiveItems}
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
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userDoc?.id])
}
