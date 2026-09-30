// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState } from "react"
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router"
import { QrCode } from "lucide-react"
import { StepCheckin } from "@/components/checkout/step-checkin"
import { KioskAccountActions } from "@/components/checkout/kiosk-account-actions"
import { VisitStartedDialog } from "@/components/checkout/visit-started-dialog"
import { useWizardContext } from "@/components/checkout/wizard-context"
import { useScanNavigation } from "@/components/qr-scanner/use-scan-navigation"
import { parseCheckoutQr } from "@/lib/parse-checkout-qr"

export const Route = createFileRoute("/_wizard/checkin")({
  component: CheckinRoute,
})

function CheckinRoute() {
  const navigate = useNavigate()
  const ctx = useWizardContext()
  const search = useSearch({ from: "/_wizard" })
  // Issue #664: a QR scanned without an open visit lands here with its
  // `/visit/add/...` path in `next`. The param is untrusted — only the
  // shapes the QR allow-list parser accepts count, anything else is ignored
  // and the check-in behaves as if it were absent.
  const nextIntent = search.next ? parseCheckoutQr(search.next) : null
  const navigateToIntent = useScanNavigation()
  // Kiosk "Besuch starten": the checkout doc is written, the confirmation
  // dialog shows and then resets the terminal for the next person.
  const [visitStarted, setVisitStarted] = useState(false)

  return (
    <>
      {nextIntent && (
        <div className="mb-6 flex items-start gap-3 rounded-md border border-cog-teal/40 bg-cog-teal/5 px-4 py-3">
          <QrCode className="h-5 w-5 mt-0.5 shrink-0 text-cog-teal-dark" aria-hidden />
          <p className="text-sm text-foreground">
            Bitte zuerst einchecken — danach geht es direkt weiter zum
            gescannten Material.
          </p>
        </div>
      )}
      <StepCheckin
      persons={ctx.persons}
      personsDispatch={ctx.personsDispatch}
      isAnonymous={ctx.isAnonymous}
      kiosk={ctx.kiosk}
      isAccountLoggedIn={ctx.isAccountLoggedIn}
      signedInUserId={ctx.identifiedUserDoc?.id ?? null}
      signedInEmail={ctx.identifiedUserDoc?.email ?? null}
      // ADR-0029: the identified principal (account OR tag-tap badge user)
      // is exempt from the advisory account-holder roster check.
      ownerUserId={ctx.identifiedUserRef?.id ?? null}
      isMember={ctx.isMember}
      // Issue #465: a checkout already running flips the kiosk footer primary
      // from "Besuch starten" to "Material erfassen".
      hasOpenCheckout={!!ctx.openCheckout}
      // Issue #664: with a scanned target waiting, the footer action says
      // where it leads instead of the generic "Weiter" / "Material erfassen".
      advanceLabel={
        nextIntent
          ? ctx.openCheckout
            ? "Material hinzufügen"
            : "Besuch starten und Material hinzufügen"
          : undefined
      }
      familyCandidates={ctx.familyCandidates}
      // Kiosk: badge-tap progress/errors render inside the NFC affordance
      // box on this page (TagAuthOverlay stays home for browser tag taps).
      tagAuthLoading={ctx.tagAuthLoading}
      tagAuthError={ctx.tagAuthError}
      picc={ctx.picc}
      // Kiosk member-area entry points (ADR-0041); renders nothing elsewhere.
      accountActions={<KioskAccountActions />}
      // Signed-in "Abmelden" and the anon "Von vorne beginnen" share one
      // primitive: drop the session + hard-reload to a fresh /checkin.
      onSignOut={ctx.startOver}
      onAdvance={async () => {
        // Issue #151: eager anonymous sign-in so /visit can write items.
        if (ctx.isAnonymous) await ctx.signInAnonymouslyIfNeeded()
        try {
          // Issue #246: persist the person roster onto the open checkout doc.
          await ctx.persistPersons()
        } catch {
          // persistPersons already toasted (ADR-0025) and re-threw; stay on
          // /checkin so the user can retry instead of bouncing to the
          // no-checkout gate on /visit.
          return
        }
        const wizardSearch = ctx.kiosk ? { kiosk: "" } : {}
        if (nextIntent) {
          // Same hand-off as "Weiter" → /visit: the checkout create has
          // resolved, so the wizard's items listener may open on the picker.
          navigateToIntent(nextIntent, {
            search: wizardSearch,
            replace: false,
          })
          return
        }
        navigate({ to: "/visit", search: wizardSearch })
      }}
      // Kiosk primary action: check in (create the checkout) WITHOUT
      // navigating to /visit — the visitor is done at the terminal. The
      // confirmation dialog below then frees the kiosk via startOver.
      //
      // Issue #467: only offer "Besuch starten" when the kiosk visitor is
      // already identified (tag-tap or signed in). For a truly anonymous
      // kiosk guest the checkout is bound to a throwaway anon session that
      // they can't return to, so "starting a visit" they'd immediately lose
      // is pointless — they keep the plain "Weiter" flow instead.
      onStartVisit={
        ctx.kiosk && !ctx.isAnonymous
          ? async () => {
              if (ctx.isAnonymous) await ctx.signInAnonymouslyIfNeeded()
              try {
                await ctx.persistPersons()
              } catch {
                // persistPersons already toasted (ADR-0025); stay on
                // /checkin so the user can retry.
                return
              }
              setVisitStarted(true)
            }
          : undefined
      }
    />
    <VisitStartedDialog
      open={visitStarted}
      onDone={() => void ctx.startOver()}
    />
    </>
  )
}
