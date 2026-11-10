// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kiosk flavor of the "Willkommen" onboarding (issue #595, ADR-0022
 * amendment). An unclaimed/imported member who signs in at the kiosk (email
 * code or badge tap) runs the same 4-step wizard as on their own device —
 * mounted by _wizard.tsx for every kiosk session; it shows itself when the
 * session payload says the profile is incomplete (ACC-2).
 *
 * Differences from the own-device wrapper (welcome-onboarding.tsx):
 *  - whether to run comes from the session payload (`profileComplete`), and
 *    the users doc is read only after the code on leaving step 1 (ADR-0041,
 *    #854): whoever holds someone else's badge must neither see the stored
 *    profile nor set it, nor accept the terms in their name. The callable
 *    refuses a badge tap alone too; code sign-ins skip the step;
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
import { getDoc } from "firebase/firestore"
import { Loader2, Mail, MailCheck } from "lucide-react"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { userRef } from "@modules/lib/firestore-helpers"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { rpcCallable } from "@modules/lib/rpc"
import type { TokenUser } from "@modules/lib/token-auth"
import { Button } from "@modules/components/ui/button"
import { useKioskElevation } from "@/components/checkout/kiosk-elevation-dialog"
import {
  WelcomeOnboardingView,
  type OnboardingProfileUpdate,
  type ProfileFields,
} from "./welcome-onboarding"

interface CompleteOnboardingKioskInput {
  profile?: OnboardingProfileUpdate
  termsAccepted?: boolean
}

export function KioskWelcomeOnboarding({ tokenUser }: { tokenUser: TokenUser }) {
  const db = useDb()
  const functions = useFunctions()
  const { mutate, loading: saving } = useAsyncMutation({
    context: "checkout.kioskOnboarding",
  })
  // The hook owns the toast (ADR-0025): a failed read leaves the person on
  // step 1 with a message instead of a silent dead button.
  const { mutate: load, loading: loadingProfile } = useAsyncMutation<
    ProfileFields | null
  >({
    context: "checkout.kioskOnboardingProfile",
    errorMessage: "Dein Profil konnte nicht geladen werden. Bitte versuche es nochmals.",
  })
  const { ensureElevated } = useKioskElevation()

  // Latched at mount (the component is keyed per user): accepting terms in
  // step 3 completes the profile, and the dialog must survive through step
  // 4. Only an explicit `false` runs it — a session minted before the
  // payload carried the flag skips the onboarding rather than misfire.
  const [needed] = useState(tokenUser.profileComplete === false)
  const [done, setDone] = useState(false)

  if (!needed || done) return null

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

  // Step up (a no-op for a code sign-in), then read the stored profile for
  // step 2 — only the elevated session may (#854).
  const loadStoredProfile = async (): Promise<ProfileFields | null> => {
    const elevated = await new Promise<boolean>((resolve) =>
      ensureElevated(
        () => resolve(true),
        () => resolve(false),
      ),
    )
    if (!elevated) return null
    try {
      return await load(async () => {
        const user = (await getDoc(userRef(db, tokenUser.userId))).data()
        return {
          firstName: user?.firstName ?? tokenUser.firstName ?? "",
          lastName: user?.lastName ?? tokenUser.lastName ?? "",
          company: user?.billingAddress?.company ?? "",
          street: user?.billingAddress?.street ?? "",
          zip: user?.billingAddress?.zip ?? "",
          city: user?.billingAddress?.city ?? "",
          phone: user?.phone ?? "",
        }
      })
    } catch {
      return null
    }
  }

  const email = tokenUser.email ?? ""
  return (
    <WelcomeOnboardingView
      prefill={{
        firstName: tokenUser.firstName ?? "",
        lastName: tokenUser.lastName ?? "",
        company: "",
        street: "",
        zip: "",
        city: "",
        phone: "",
      }}
      email={email}
      isFirma={tokenUser.userType === "firma"}
      isFamilie={false}
      membership={null}
      saving={saving || loadingProfile}
      persistProfile={persistProfile}
      persistTerms={persistTerms}
      resourcesStep={<StepResourcesKiosk email={email} />}
      beforeProfile={loadStoredProfile}
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
        Familienmitglieder hinzufügen) verwaltest du in deinem Konto — hier
        am Kiosk über das Menü oben rechts mit deinem Namen oder zuhause auf
        deinem eigenen Handy oder Computer.
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
