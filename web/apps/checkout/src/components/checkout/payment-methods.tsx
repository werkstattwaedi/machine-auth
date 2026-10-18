// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * UI side of the payment methods (issue #750): one entry per
 * `PaymentMethod` from `@oww/shared` with the copy of its card on step 3,
 * its instruction and commit button on step 4, and its confirmation.
 * Which methods a customer sees is decided by `enabledPaymentMethods`
 * (client type + membership), not here — adding an integration means one
 * shared table entry plus one entry below.
 */

import type { ReactNode } from "react"
import { CreditCard, FileText, PartyPopper } from "lucide-react"
import { PAYMENT_METHOD_INFO, type PaymentChoice, type PaymentMethod } from "@oww/shared"

export interface PaymentData {
  /** Doc id of the underlying bill — drives the PDF download action. */
  billId: string
  checkoutId: string | null
  qrBillPayload: string
  /** RaiseNow PayLink; null when the integration is switched off server-side. */
  paylinkUrl: string | null
  creditor: {
    iban: string
    name: string
    street: string
    location: string
  }
  reference: string
  payerName: string
  payerEmail: string
  amount: string
  currency: string
  /**
   * The method the bill is committed with; null when it is free. A repeated
   * close answers with the first committed method, so the confirmation
   * renders this, not what the client asked for.
   */
  paymentMethod?: PaymentMethod | null
}

/** A card on step 3: a payment method, or the single card of a CHF 0 visit. */
export type { PaymentChoice }

// Swiss cross SVG for QR bill center overlay (SIX Swiss Payment Standards spec).
export const SWISS_CROSS_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect width="100" height="100" fill="white"/>' +
  '<rect x="3" y="3" width="94" height="94" fill="black"/>' +
  '<polygon points="20,40 20,60 40,60 40,80 60,80 60,60 80,60 80,40 60,40 60,20 40,20 40,40" fill="white"/>' +
  '</svg>',
)}`

export const TWINT_LOGO_URL = "https://assets.raisenow.io/twint-logo-dark.svg"

/** What the copy may mention: the payer's e-mail and the Sammelrechnung date. */
export interface ChoiceCopyContext {
  email: string
  /** "1. November" — the first of next month, when the Sammelrechnung goes out. */
  monthlyDate: string
}

export interface PaymentChoiceUi {
  icon: ReactNode
  /** Render the icon on the brand's dark chip (TWINT styleguide). */
  darkIconChip?: boolean
  title: string
  /** Step 3: one line under the title. */
  description: string
  /** Step 3: the teal action label on the right of the card. */
  actionLabel: string
  /** Step 4: the instruction above the commit button. */
  instruction: (ctx: ChoiceCopyContext) => ReactNode
  /** Step 4: the commit button. TWINT renders its own brand button. */
  commitLabel: string
  /** After the commit: the status next to the check. */
  doneStatus: string
  /** After the commit: the green box; null when nothing was sent. */
  doneBox: ((ctx: ChoiceCopyContext) => ReactNode) | null
  /** After the commit: a line below the box, for what may still go wrong. */
  doneNote?: ReactNode
}

/** Where a person turns when a payment did not go through. */
export const KASSE_EMAIL = "kasse@werkstattwaedi.ch"

export const PAYMENT_CHOICE_UI: Record<PaymentChoice, PaymentChoiceUi> = {
  rechnung: {
    icon: <FileText className="h-5 w-5" strokeWidth={1.6} />,
    title: PAYMENT_METHOD_INFO.rechnung.label,
    description: "Rechnung per E-Mail, später mit der E-Banking-App bezahlen.",
    actionLabel: "Rechnung erhalten",
    instruction: ({ email }) =>
      email ? (
        <>
          Wir schicken dir die Rechnung an <strong>{email}</strong>.
        </>
      ) : (
        "Wir schicken dir die Rechnung per E-Mail."
      ),
    commitLabel: "Rechnung senden",
    doneStatus: "Rechnung gesendet",
    doneBox: ({ email }) =>
      email ? (
        <>
          Die Rechnung haben wir dir an <strong>{email}</strong> gesendet.
        </>
      ) : null,
  },
  monthly: {
    icon: <CalendarMark />,
    title: PAYMENT_METHOD_INFO.monthly.label,
    description: "Kommt zu deinen offenen Posten, Rechnung am 1. des Monats.",
    actionLabel: "Auf Sammelrechnung",
    instruction: ({ monthlyDate }) => (
      <>
        Am <strong data-testid="monthly-date">{monthlyDate}</strong> kommt eine
        Rechnung über alle offenen Posten.
      </>
    ),
    commitLabel: "Auf Sammelrechnung setzen",
    doneStatus: "Auf der Sammelrechnung",
    doneBox: ({ email, monthlyDate }) =>
      email ? (
        <>
          Die Sammelrechnung kommt am{" "}
          <span data-testid="monthly-date">{monthlyDate}</span> an{" "}
          <strong>{email}</strong>.
        </>
      ) : null,
  },
  raisenow: {
    icon: <img src={TWINT_LOGO_URL} alt="" className="h-5 w-auto" />,
    darkIconChip: true,
    title: PAYMENT_METHOD_INFO.raisenow.label,
    description: "Jetzt mit der TWINT-App bezahlen.",
    actionLabel: "Mit TWINT bezahlen",
    instruction: () => "Bezahle direkt in der TWINT-App.",
    commitLabel: "Mit TWINT bezahlen",
    // Nothing confirms the TWINT payment itself (BIL-6): TWINT sends its
    // own receipt, we send the Beleg, and a payment that never arrives is
    // followed up by hand at reconciliation (BIL-34), with a QR-Rechnung.
    doneStatus: "Beleg gesendet",
    doneBox: ({ email }) =>
      email ? (
        <>
          Den Beleg haben wir dir an <strong>{email}</strong> gesendet.
        </>
      ) : null,
    doneNote: (
      <>
        Hat die TWINT-Zahlung nicht geklappt? Melde dich bei{" "}
        <a href={`mailto:${KASSE_EMAIL}`} className="font-semibold underline">
          {KASSE_EMAIL}
        </a>
        .
      </>
    ),
  },
  // Paid at the terminal next to the kiosk screen. The terminal's own
  // result only drives this screen; Wallee's confirmation closes the
  // checkout and mails the Quittung (BIL-39) — possibly only the next
  // night, hence "kommt", not "gesendet".
  wallee_terminal: {
    icon: <CreditCard className="h-5 w-5" strokeWidth={1.6} />,
    title: PAYMENT_METHOD_INFO.wallee_terminal.label,
    description: "Jetzt am Terminal neben dem Bildschirm bezahlen.",
    actionLabel: "Am Terminal bezahlen",
    instruction: () => "Folge den Anweisungen am Terminal.",
    commitLabel: "Am Terminal bezahlen",
    doneStatus: "Bezahlt",
    doneBox: ({ email }) =>
      email ? (
        <>
          Die Quittung kommt per E-Mail an <strong>{email}</strong>.
        </>
      ) : null,
  },
  // Not the check mark: the status line next to it already shows one.
  free: {
    icon: <PartyPopper className="h-5 w-5" strokeWidth={1.6} />,
    title: "Kostenlos",
    description: "Für diesen Besuch ist nichts zu bezahlen.",
    actionLabel: "Abschliessen",
    instruction: () => null,
    commitLabel: "Abschliessen",
    doneStatus: "Danke für deinen Besuch!",
    // The Beleg is mailed when there is an address (BIL-26); without one
    // nothing is owed, so there is nothing to warn about either (CHK-23).
    doneBox: ({ email }) => (
      <>
        Für diesen Besuch ist nichts zu bezahlen.{" "}
        {email ? (
          <>
            Den Beleg haben wir dir an <strong>{email}</strong> gesendet.
          </>
        ) : (
          "Bis zum nächsten Mal in der Werkstatt!"
        )}
      </>
    ),
  },
}

/** "1. November": the first of the month after `now`, in Swiss German. */
export function firstOfNextMonth(now: Date = new Date()): string {
  const first = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return first.toLocaleDateString("de-CH", { day: "numeric", month: "long" })
}

// ---------------------------------------------------------------------------
// Method marks (icons)
// ---------------------------------------------------------------------------

function CalendarMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M9 16l2 2 4-4" />
    </svg>
  )
}
