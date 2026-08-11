// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kiosk flavor of the "Willkommen" onboarding (issue #595, ADR-0022
 * amendment). An unclaimed/imported member who signs in at the kiosk (email
 * code or badge tap) runs the same 4-step wizard as on their own device —
 * mounted by _wizard.tsx whenever the established kiosk session's user doc
 * is incomplete.
 *
 * Differences from the own-device wrapper (welcome-onboarding.tsx):
 *  - the user doc is read directly via the actsAs read rule (tag sessions
 *    have no auth-context userDoc subscription);
 *  - persistence goes through the `completeOnboardingKiosk` callable —
 *    Firestore rules deliberately reject users-doc writes from synthetic
 *    kiosk principals;
 *  - step 2 shows no membership internals (the kiosk only knows a boolean,
 *    issue #358);
 *  - step 4 swaps the member-area links for the account-instructions email
 *    offer: family members, Belege & Co. live in the member area, which the
 *    kiosk cannot open.
 */

import { useState } from "react"
import { Loader2, Mail, MailCheck } from "lucide-react"
import { isProfileComplete } from "@modules/lib/auth"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { useDocument } from "@modules/lib/firestore"
import { userRef } from "@modules/lib/firestore-helpers"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { rpcCallable } from "@modules/lib/rpc"
import { Button } from "@modules/components/ui/button"
import {
  WelcomeOnboardingView,
  type OnboardingProfileUpdate,
} from "./welcome-onboarding"

interface CompleteOnboardingKioskInput {
  profile?: OnboardingProfileUpdate
  termsAccepted?: boolean
}

export function KioskWelcomeOnboarding({ userId }: { userId: string }) {
  const db = useDb()
  const functions = useFunctions()
  const { data: userDoc } = useDocument(userRef(db, userId))
  const { mutate, loading: saving } = useAsyncMutation({
    context: "checkout.kioskOnboarding",
  })

  // Latch on first doc load (mirrors the own-device wrapper): accepting
  // terms in step 3 completes the profile, and the dialog must survive
  // through step 4. `done` dismisses for the rest of this kiosk session.
  const [needed, setNeeded] = useState<boolean | null>(null)
  const [done, setDone] = useState(false)
  if (userDoc && needed === null) {
    setNeeded(!isProfileComplete(userDoc))
  }

  if (!userDoc || needed !== true || done) return null

  const call = rpcCallable<
    CompleteOnboardingKioskInput,
    { ok: true }
  >(functions, "authCall", "completeOnboardingKiosk")

  // The hook owns the error toast and re-throws — report failure so the
  // view short-circuits and stays put.
  const persistProfile = async (
    profile: OnboardingProfileUpdate,
  ): Promise<boolean> => {
    try {
      await mutate(async () => {
        await call({ profile })
      })
    } catch {
      return false
    }
    return true
  }

  const persistTerms = async (): Promise<boolean> => {
    try {
      await mutate(async () => {
        await call({ termsAccepted: true })
      })
    } catch {
      return false
    }
    return true
  }

  return (
    <WelcomeOnboardingView
      prefill={{
        firstName: userDoc.firstName ?? "",
        lastName: userDoc.lastName ?? "",
        company: userDoc.billingAddress?.company ?? "",
        street: userDoc.billingAddress?.street ?? "",
        zip: userDoc.billingAddress?.zip ?? "",
        city: userDoc.billingAddress?.city ?? "",
        phone: userDoc.phone ?? "",
      }}
      email={userDoc.email ?? ""}
      isFirma={userDoc.userType === "firma"}
      isFamilie={false}
      membership={null}
      saving={saving}
      persistProfile={persistProfile}
      persistTerms={persistTerms}
      resourcesStep={<StepResourcesKiosk email={userDoc.email ?? ""} />}
      onDone={() => setDone(true)}
    />
  )
}

/**
 * Kiosk step 4: the member-area links (and family management) can't open
 * here — the actsAs session is checkout-only. Offer the instructions email
 * instead so everything else can be finished later on the member's own
 * device.
 */
function StepResourcesKiosk({ email }: { email: string }) {
  const [sent, setSent] = useState(false)
  const { mutate, loading } = useAsyncMutation({
    context: "checkout.kioskOnboardingInstructions",
  })
  const functions = useFunctions()

  const send = async () => {
    // Session-bound: the server derives the recipient from the actsAs
    // claim — the payload carries nothing.
    const sendInstructions = rpcCallable<
      Record<string, never>,
      { ok: true; throttled: boolean }
    >(functions, "authCall", "sendAccountInstructions")
    try {
      await mutate(async () => {
        await sendInstructions({})
      })
    } catch {
      return
    }
    setSent(true)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 font-heading text-[22px] font-bold">
          Alles bereit!
        </h2>
        <p className="m-0 text-[13px] text-muted-foreground">
          Du kannst jetzt hier einchecken — dein Besuch startet gleich.
        </p>
      </div>

      <p className="m-0 text-sm leading-relaxed">
        Deine Besuche, Belege und deine Mitgliedschaft (z.B.
        Familienmitglieder hinzufügen) verwaltest du in deinem Konto — das
        geht am Kiosk nicht, sondern auf deinem eigenen Handy oder Computer.
      </p>

      <div
        className="rounded-[10px] bg-cog-teal-light p-4"
        data-testid="kiosk-onboarding-instructions"
      >
        {sent ? (
          <p className="m-0 flex items-start gap-2.5 text-sm leading-relaxed">
            <MailCheck
              className="mt-0.5 h-[18px] w-[18px] flex-shrink-0 text-cog-teal-dark"
              aria-hidden
            />
            <span>
              <strong>E-Mail geschickt!</strong> Die Anleitung wartet in
              deinem Postfach ({email}).
            </span>
          </p>
        ) : (
          <>
            <p className="m-0 text-sm leading-relaxed">
              Sollen wir dir eine E-Mail mit der Anleitung schicken, wie du
              dein Konto zuhause nutzt?
            </p>
            <Button
              type="button"
              onClick={() => void send()}
              disabled={loading}
              data-testid="kiosk-onboarding-send-instructions"
              className="mt-2.5 h-9 bg-cog-teal text-sm font-semibold text-white hover:bg-cog-teal-dark"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Mail className="h-4 w-4" aria-hidden />
              )}
              E-Mail mit Anleitung senden
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
