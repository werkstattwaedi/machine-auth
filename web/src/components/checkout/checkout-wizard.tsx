// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useEffect } from "react"
import { useAuth } from "@/lib/auth"
import { useTokenAuth } from "@/lib/token-auth"
import { useCollection } from "@/lib/firestore"
import {
  where,
  addDoc,
  collection,
  serverTimestamp,
  updateDoc,
  doc,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { userRef } from "@/lib/firestore-helpers"
import { PageLoading } from "@/components/page-loading"
import { CheckoutProgress } from "./checkout-progress"
import { StepCheckin } from "./step-checkin"
import { StepWorkshops } from "./step-workshops"
import { StepCheckout } from "./step-checkout"
import { PaymentResult } from "./payment-result"
import {
  useCheckoutState,
  type CheckoutAction,
  type UsageMachineItem,
  type UsageMaterialItem,
} from "./use-checkout-state"
import type { UserType } from "@/lib/pricing"

interface CheckoutWizardProps {
  picc?: string
  cmac?: string
}

interface UsageMachineDoc {
  machine: { id: string }
  checkIn: { toDate(): Date }
  checkOut?: { toDate(): Date } | null
  checkout?: { id: string } | null
  workshop?: string
}

interface UsageMaterialDoc {
  description: string
  details?: { totalPrice?: number; category?: string; quantity?: number }
  created: { toDate(): Date }
  checkout?: { id: string } | null
  workshop?: string
}

export function CheckoutWizard({ picc, cmac }: CheckoutWizardProps) {
  const { user, userDoc } = useAuth()
  const { tokenUser, loading: tokenLoading } = useTokenAuth(
    picc ?? null,
    cmac ?? null,
  )
  const { state, dispatch } = useCheckoutState()
  const [submitting, setSubmitting] = useState(false)

  // Determine auth mode
  const isA3 = !!user && !!userDoc
  const isA2 = !isA3 && !!tokenUser
  const isAnonymous = !isA3 && !isA2
  const identifiedUserDoc = isA3 ? userDoc : null
  const identifiedUserRef = identifiedUserDoc
    ? userRef(identifiedUserDoc.id)
    : undefined

  // Fetch unchecked-out machine usage for identified users (null path = disabled)
  const { data: rawMachineUsage, loading: loadingMachine } =
    useCollection<UsageMachineDoc>(
      identifiedUserRef ? "usage_machine" : null,
      ...(identifiedUserRef
        ? [
            where("userId", "==", identifiedUserRef),
            where("checkout", "==", null),
          ]
        : []),
    )

  // Fetch unchecked-out material usage for identified users (null path = disabled)
  const { data: rawMaterialUsage, loading: loadingMaterial } =
    useCollection<UsageMaterialDoc>(
      identifiedUserRef ? "usage_material" : null,
      ...(identifiedUserRef
        ? [
            where("userId", "==", identifiedUserRef),
            where("checkout", "==", null),
          ]
        : []),
    )

  // Pre-fill primary person for A3 (logged-in) users
  usePreFillPerson(identifiedUserDoc, dispatch, state.persons)

  // Sync usage data into state
  useEffect(() => {
    if (loadingMachine) return
    const items: UsageMachineItem[] = rawMachineUsage.map((u) => ({
      id: u.id,
      machineId: u.machine?.id ?? "",
      machineName: u.machine?.id ?? "Unbekannt",
      workshop: u.workshop ?? "",
      checkIn: u.checkIn?.toDate() ?? new Date(),
      checkOut: u.checkOut?.toDate() ?? null,
    }))
    dispatch({ type: "SET_MACHINE_USAGE", items })
  }, [rawMachineUsage, loadingMachine, dispatch])

  useEffect(() => {
    if (loadingMaterial) return
    const items: UsageMaterialItem[] = rawMaterialUsage.map((u) => ({
      id: u.id,
      description: u.description,
      workshop: u.workshop ?? "",
      totalPrice: u.details?.totalPrice ?? 0,
      category: u.details?.category ?? "",
      quantity: u.details?.quantity ?? 0,
    }))
    dispatch({ type: "SET_MATERIAL_USAGE", items })
  }, [rawMaterialUsage, loadingMaterial, dispatch])

  if (tokenLoading || loadingMachine || loadingMaterial) {
    return <PageLoading />
  }

  if (state.submitted) {
    return (
      <PaymentResult
        totalPrice={state.totalPrice}
        onReset={() => dispatch({ type: "RESET" })}
      />
    )
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const personFees = state.persons.reduce((sum, p) => sum + p.fee, 0)
      const materialTotal = state.materialUsage.reduce(
        (sum, u) => sum + u.totalPrice,
        0,
      )
      const total = personFees + materialTotal + state.tip

      // Create checkout document
      const checkoutDocRef = await addDoc(collection(db, "checkouts"), {
        userId: identifiedUserRef ?? null,
        time: serverTimestamp(),
        persons: state.persons.map((p) => ({
          name: `${p.firstName} ${p.lastName}`,
          email: p.email,
          userType: p.userType,
          usageType: p.usageType,
          fee: p.fee,
        })),
        machineUsageRefs: state.machineUsage.map((u) =>
          doc(db, "usage_machine", u.id),
        ),
        materialUsageRefs: state.materialUsage.map((u) =>
          doc(db, "usage_material", u.id),
        ),
        tip: state.tip,
        totalPrice: total,
        notes: null,
        modifiedBy: user?.uid ?? null,
        modifiedAt: serverTimestamp(),
      })

      // Mark usage records as checked out
      const coRef = doc(db, "checkouts", checkoutDocRef.id)
      await Promise.all([
        ...state.machineUsage.map((u) =>
          updateDoc(doc(db, "usage_machine", u.id), { checkout: coRef }),
        ),
        ...state.materialUsage.map((u) =>
          updateDoc(doc(db, "usage_material", u.id), { checkout: coRef }),
        ),
      ])

      dispatch({
        type: "SET_SUBMITTED",
        checkoutId: checkoutDocRef.id,
        totalPrice: total,
      })
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
        />
      )}
      {state.step === 1 && (
        <StepWorkshops
          state={state}
          dispatch={dispatch}
          isAnonymous={isAnonymous}
        />
      )}
      {state.step === 2 && (
        <StepCheckout
          state={state}
          dispatch={dispatch}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
      )}
    </div>
  )
}

/**
 * Pre-fill the primary person card with data from an identified user doc.
 * Only runs once when the userDoc becomes available and the person hasn't been pre-filled.
 */
function usePreFillPerson(
  userDoc: { id: string; name: string; displayName: string; email?: string; userType?: string; termsAcceptedAt?: unknown } | null,
  dispatch: React.Dispatch<CheckoutAction>,
  persons: { id: string; isPreFilled: boolean }[],
) {
  useEffect(() => {
    if (!userDoc) return
    const primary = persons[0]
    if (!primary || primary.isPreFilled) return

    const [firstName = "", ...rest] = (
      userDoc.name || userDoc.displayName
    ).split(" ")
    dispatch({
      type: "UPDATE_PERSON",
      id: primary.id,
      updates: {
        firstName,
        lastName: rest.join(" "),
        email: userDoc.email ?? "",
        userType: (userDoc.userType as UserType) ?? "erwachsen",
        isPreFilled: true,
        termsAccepted: !!userDoc.termsAcceptedAt,
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userDoc?.id])
}
