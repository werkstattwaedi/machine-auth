// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useAuth } from "@modules/lib/auth"
import { useTokenAuth } from "@modules/lib/token-auth"
import { useBridge } from "@modules/lib/use-bridge"
import { useCollection } from "@modules/lib/firestore"
import { where, orderBy, documentId } from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { serverTimestamp, type Firestore } from "firebase/firestore"
import {
  userRef,
  checkoutRef,
  checkoutsCollection,
  checkoutItemsCollection,
  membershipsCollection,
  usersCollection,
} from "@modules/lib/firestore-helpers"
import { useDb, useFunctions, useFirebaseAuth } from "@modules/lib/firebase-context"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { usePricingConfig } from "@modules/lib/workshop-config"
import { PageLoading } from "@modules/components/page-loading"
import { EmptyState } from "@modules/components/empty-state"
import { AlertTriangle } from "lucide-react"
import { CheckoutProgress } from "./checkout-progress"
import { StepCheckin } from "./step-checkin"
import { StepWorkshops } from "./step-workshops"
import { StepCheckout, computeCheckoutCosts } from "./step-checkout"
import { PaymentResult, type PaymentData } from "./payment-result"
import {
  useCheckoutState,
  type CheckoutAction,
} from "./use-checkout-state"
import type { UserType, UsageType } from "@modules/lib/pricing"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import type { PricingModel } from "@modules/lib/workshop-config"
import type {
  CheckoutDoc,
  CheckoutPersonDoc,
} from "@modules/lib/firestore-entities"
import type { CheckoutPerson } from "./use-checkout-state"

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
  const bridge = useBridge()
  const { state, dispatch } = useCheckoutState(initialStep)
  // ADR-0025: route the checkout submit through useAsyncMutation so a
  // failed callable surfaces a German error toast + inline alert (B5
  // launch fix), and the wizard stays at step 2 with the submit button
  // re-enabled instead of silently resetting.
  const submit = useAsyncMutation<PaymentData>({
    context: "checkout.closeAndPay",
    errorMessage:
      "Bezahlung konnte nicht erstellt werden. Bitte erneut versuchen.",
  })
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

  // Issue #209: family-roster quick-add. Subscribe to the signed-in user's
  // active family membership and surface co-members not yet on the visit.
  // - Anonymous, tag-tap, and unidentified users: skipped (selfUserId null).
  // - Single membership / non-owner: produces zero candidates after the
  //   `excluding self` filter, so the quick-add row is hidden by StepCheckin.
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
  // Member ids excluding self. Bound the `in` query at 30 (Firestore limit);
  // a family is capped at five members + self in practice.
  //
  // Self is intentionally excluded from the query (the caller already has
  // their own user doc via `identifiedUserDoc`); a "re-add self" candidate
  // is synthesized below from that doc when self is no longer on the
  // visit (issue #246), so we don't pay an extra Firestore read for
  // something we can derive client-side.
  const otherMemberIds = useMemo(() => {
    if (!familyMembership || !selfUserId) return [] as string[]
    const ids = familyMembership.members
      .map((m) => m.id)
      .filter((id) => id !== selfUserId)
    return ids.slice(0, 30)
  }, [familyMembership, selfUserId])
  const { data: familyMemberDocs } = useCollection(
    otherMemberIds.length > 0 ? usersCollection(db) : null,
    where(documentId(), "in", otherMemberIds.length > 0 ? otherMemberIds : [""]),
  )
  // Dedupe candidates against persons already on the visit (matched by
  // userId attached when the card was added via quick-add or the primary
  // pre-fill effect).
  const claimedUserIds = useMemo(
    () => new Set(state.persons.map((p) => p.userId).filter(Boolean) as string[]),
    [state.persons],
  )
  const familyCandidates = useMemo(() => {
    const candidates = familyMemberDocs
      .filter((m) => !claimedUserIds.has(m.id))
      .map((m) => ({
        userId: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        // Child accounts have email: null; surface as empty string so
        // the pre-filled card simply hides the field.
        email: m.email ?? "",
        userType: (m.userType as UserType) ?? "erwachsen",
      }))
    // Issue #246: after the signed-in user removes themselves, re-surface
    // them as a quick-add chip so the family owner can put themselves
    // back on the visit without re-typing. Synthesized from
    // `identifiedUserDoc` so no extra Firestore read is needed.
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

  // Issue #246: rehydrate persons from the open Firestore checkout doc.
  // When the user navs to /profile and back, the wizard remounts with a
  // fresh reducer state — but the still-open checkout doc carries the
  // person roster we wrote at the previous "Weiter" click. Restore it
  // exactly once per `openCheckout` arrival so subsequent local edits
  // (`UPDATE_PERSON`, etc.) are not clobbered.
  const rehydratedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!openCheckout) {
      // The current open checkout is gone (kiosk reset, submit, etc.) —
      // clear the latch so a future doc with the same id (unlikely) would
      // still rehydrate. Also covers the test path where the doc
      // arrives after the initial mount.
      rehydratedRef.current = null
      return
    }
    if (rehydratedRef.current === openCheckout.id) return
    if (!openCheckout.persons || openCheckout.persons.length === 0) {
      // Nothing to rehydrate — but latch so we don't keep re-checking.
      rehydratedRef.current = openCheckout.id
      return
    }
    const rehydrated = openCheckout.persons.map((p) =>
      personDocToLocal(p),
    )
    dispatch({ type: "REPLACE_PERSONS", persons: rehydrated })
    rehydratedRef.current = openCheckout.id
  }, [openCheckout, dispatch])

  // Issue #246: persist the current `persons` array to the open checkout
  // doc so a nav-away-and-back can rehydrate. Called from step 0's
  // "Weiter" handler (via `onAdvance`), after validation passes and the
  // anonymous principal (if any) has signed in.
  //
  // - If a checkout doc already exists for this principal, update its
  //   `persons` array in place.
  // - Otherwise create the doc with the persons already populated; the
  //   step-workshops add-item path will see an existing doc and skip
  //   its lazy-create.
  //
  // Errors are swallowed (useFirestoreMutation already toasts +
  // telemeters). A failed persist must not block the step transition —
  // the user can keep going; the worst case is the persons aren't
  // restored after a nav-away.
  const auth = useFirebaseAuth()
  const fsMutation = useFirestoreMutation()
  const persistPersons = useCallback(async () => {
    const personDocs = state.persons.map((p) => personLocalToDoc(p, db))
    try {
      if (openCheckout) {
        await fsMutation.update(checkoutRef(db, openCheckout.id), {
          persons: personDocs,
        })
      } else {
        // Create a new open checkout doc with persons populated. Mirrors
        // the lazy-create path in step-workshops.tsx so the schema and
        // the security-rule field set stay in sync.
        const callerUid = auth?.currentUser?.uid ?? null
        // Issue #318: stamp the creating Firebase Auth UID on every
        // client-side create (anonymous OR signed-in) so the cleanup
        // job has a single, generally-applicable join key. The rules
        // require firebaseUid == request.auth.uid; signed-in users'
        // UIDs never appear in the expired-anon list the cleanup
        // queries against, so their checkouts are never touched.
        await fsMutation.add(checkoutsCollection(db), {
          userId: identifiedUserRef ?? null,
          status: "open",
          usageType: state.usageType,
          created: serverTimestamp() as unknown as CheckoutDoc["created"],
          workshopsVisited: [],
          persons: personDocs,
          modifiedBy: callerUid,
          modifiedAt: serverTimestamp() as unknown as CheckoutDoc["modifiedAt"],
          firebaseUid: callerUid,
        } as unknown as CheckoutDoc)
      }
    } catch {
      // Hook already toasted + reported telemetry.
    }
  }, [
    state.persons,
    state.usageType,
    openCheckout,
    fsMutation,
    db,
    identifiedUserRef,
    auth,
  ])

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
    // In the Electron kiosk build, also wipe the webview's session storage
    // so any leftover Firebase Auth state is gone. A no-op outside the
    // bridge (regular browser) and in admin-mode builds (resetSession is
    // intentionally a no-op there).
    try {
      await bridge.resetSession()
    } catch (err) {
      console.error("Failed to reset bridge session:", err)
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

  // Auto-reset after submission for non-logged-in users (30s to view payment info).
  // Step 3 (Bezahlen) is the post-submit screen now; gate on that step plus
  // `submitted` (set by SET_SUBMITTED) so we don't time out a user who simply
  // navigated forward without submitting.
  useEffect(() => {
    if (!state.submitted || state.step !== 3 || isAccountLoggedIn) return
    const timer = setTimeout(() => {
      // Reuse the unified reset callback so we get the same kiosk
      // session wipe + tagSignOut + URL replace as the inactivity path.
      onResetRef.current?.()
    }, 30_000)
    return () => clearTimeout(timer)
  }, [state.submitted, state.step, isAccountLoggedIn])

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

  const handleSubmit = async () => {
    // Anonymous sign-in moved to step 1 (issue #151) — by the time the
    // user reaches the checkout step they're already a Firebase
    // principal (anonymous, real, or tag), so no extra round-trip here.

    // Calculate entry fees (client-side estimate for the receipt; the
    // server recomputes authoritatively in closeCheckoutAndGetPayment).
    // pricingConfig is non-null here — render is gated by the configError
    // check above. calculateFee returns null for unknown userType+usageType
    // combinations; treat those as zero to avoid blocking the submit on a
    // misconfigured row (the server will throw and surface the error).
    // Internal usage is never billed — entry fees, machine, and material
    // costs all collapse to 0. Mirror the server-side defense in
    // `recomputeSummary` so the displayed receipt matches what gets
    // billed; both this wizard and StepCheckout flow through
    // `computeCheckoutCosts`.
    const {
      personFees: entryFees,
      machineCost,
      materialCost,
    } = computeCheckoutCosts({
      persons: state.persons,
      usageType: state.usageType,
      items,
      config: pricingConfig,
    })
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

    // Both branches go through `submit.mutate` so a thrown callable
    // (network blip, permission denial, etc.) surfaces a German toast +
    // inline alert and re-throws — the dispatch below is short-circuited
    // and the wizard stays at step 2 with the submit button re-enabled.
    let data: PaymentData

    try {
      if (checkoutId) {
        data = await submit.mutate(async () => {
          const res = await closeCheckoutAndGetPayment({
            checkoutId,
            usageType: state.usageType,
            persons,
            summary,
          })
          return res.data
        })
      } else {
        // Degenerate path: user reached step 2 without ever adding an item
        // (so step-workshops never lazy-created a Firestore checkout doc).
        // Common case is "tip only" / "entry fee only". The callable
        // creates the doc server-side and threads its id back through
        // PaymentData so the Bezahlen step can record the customer's
        // payment-method acknowledgement on it.
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

        data = await submit.mutate(async () => {
          const res = await closeCheckoutAndGetPayment({
            newCheckout,
            usageType: state.usageType,
            persons,
            summary,
          })
          return res.data
        })
      }
    } catch {
      // Hook already toasted + telemetered; do NOT advance to the
      // "submitted" state. Stay at step 2 so the user can retry.
      return
    }

    setPaymentData(data)
    dispatch({
      type: "SET_SUBMITTED",
      checkoutId: data.checkoutId,
      totalPrice: total,
    })
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
          familyCandidates={familyCandidates}
          onSignOut={async () => {
            await signOut()
            window.location.replace(kiosk ? "/?kiosk" : "/")
          }}
          onAdvance={async () => {
            // Issue #151: eager anonymous sign-in. No-op for already
            // identified users (real, anonymous-already, or tag).
            if (isAnonymous) await signInAnonymouslyIfNeeded()
            // Issue #246: persist the current person roster onto the
            // open checkout doc so a nav-away-and-back rehydrates it.
            // Must run AFTER anon sign-in so the create/update is
            // attributable to a Firebase principal.
            await persistPersons()
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
            identifiedUserDoc?.activeMembership ? "member" : "none"
          }
        />
      )}
      {state.step === 2 && (
        <StepCheckout
          state={state}
          dispatch={dispatch}
          onSubmit={handleSubmit}
          submitting={submit.loading}
          submitError={submit.error?.message ?? null}
          items={items}
          config={pricingConfig}
        />
      )}
      {state.step === 3 && state.submitted && (
        <PaymentResult
          checkoutId={state.checkoutId}
          totalPrice={state.totalPrice}
          initialPaymentData={paymentData}
          isMember={!!identifiedUserDoc?.activeMembership}
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
      )}
    </div>
  )
}

/**
 * Pre-fill the primary person card with data from an identified user doc.
 * Issue #209: also stamps `userId: userDoc.id` so the family-roster
 * quick-add can dedupe (the signed-in user is always a `members[]` entry
 * of their own family, and we don't want a quick-add button for them).
 *
 * The fill targets the first non-pre-filled card. If a family-quick-add
 * has already been the only thing the user did (so `persons[0]` is a
 * different family member), we still want this hook to inject the
 * signed-in user — so we look for the first card without a `userId` and
 * with `isPreFilled: false`. If the user already has a card with their
 * own `userId` (e.g. they removed the original primary and re-added
 * themselves via a quick-add — though we don't render a quick-add for
 * self today, this is future-proofing), we no-op.
 */
function usePreFillPerson(
  userDoc: {
    id: string
    firstName: string
    lastName: string
    email?: string | null
    userType?: string
    termsAcceptedAt?: unknown
    billingAddress?: { company: string; street: string; zip: string; city: string } | null
  } | null,
  dispatch: React.Dispatch<CheckoutAction>,
  persons: { id: string; isPreFilled: boolean; userId?: string | null }[],
) {
  useEffect(() => {
    if (!userDoc) return
    // Already on the visit (e.g. via a prior pre-fill that ran before the
    // hook keying re-fired) — nothing to do.
    if (persons.some((p) => p.userId === userDoc.id)) return
    // Target the first card that doesn't already represent another
    // identified user. Skipping cards with `userId` set means the family
    // quick-add for a co-member doesn't get clobbered into the signed-in
    // user's profile.
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
  }, [userDoc?.id])
}

/**
 * Issue #246: serialize a local `CheckoutPerson` (firstName/lastName,
 * userId, billing fields) into the `CheckoutPersonDoc` shape that the
 * server stores on the open checkout doc. Mirrors the `persons` payload
 * the wizard sends to `closeCheckoutAndGetPayment` on submit so the
 * shape on the doc is identical regardless of which write path stamped
 * it.
 */
export function personLocalToDoc(
  p: CheckoutPerson,
  db: Firestore,
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

/**
 * Issue #246: rehydrate a `CheckoutPersonDoc` into the local
 * `CheckoutPerson` shape consumed by the reducer. Splits `name` on
 * the first space; this is lossy for last names with spaces (treated as
 * part of the last name) but symmetric with the server's `${first}
 * ${last}` join. `userRef` is unwrapped back into the doc id so the
 * family-roster dedupe logic and the closeCheckoutAndGetPayment submit
 * path both see a consistent `userId`.
 */
export function personDocToLocal(
  p: CheckoutPersonDoc,
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
    // Rehydrated persons were valid at the previous "Weiter" — treat them
    // as pre-filled so they bypass step-checkin re-validation. The user
    // can still remove them and add fresh entries.
    isPreFilled: true,
    termsAccepted: true,
    userId,
    billingCompany: p.billingAddress?.company ?? "",
    billingStreet: p.billingAddress?.street ?? "",
    billingZip: p.billingAddress?.zip ?? "",
    billingCity: p.billingAddress?.city ?? "",
  }
}
