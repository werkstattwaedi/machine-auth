// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * UI side of the payment methods on Step 4 (Bezahlen): one entry per
 * `PaymentMethod` from `@oww/shared` with its tab icon, instruction panel
 * and commit label. Which methods a customer sees is decided by
 * `enabledPaymentMethods` (client type + membership), not here — adding an
 * integration means one shared table entry plus one entry below.
 */

import { useCallback, useEffect, useRef, type ReactNode } from "react"
import { QRCodeSVG } from "qrcode.react"
import { FileText } from "lucide-react"
import { PAYMENT_METHOD_INFO, type PaymentMethod } from "@oww/shared"
import { formatCHF } from "@modules/lib/format"
import { useBridge } from "@modules/lib/use-bridge"

export interface PaymentData {
  /** Doc id of the underlying bill — drives the PDF download action. */
  billId: string
  /** Doc id of the checkout — used to record the customer's payment-method
   *  acknowledgement once they pick a method and click the commit button. */
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
}

// Swiss cross SVG for QR bill center overlay (SIX Swiss Payment Standards spec).
export const SWISS_CROSS_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect width="100" height="100" fill="white"/>' +
  '<rect x="3" y="3" width="94" height="94" fill="black"/>' +
  '<polygon points="20,40 20,60 40,60 40,80 60,80 60,60 80,60 80,40 60,40 60,20 40,20 40,40" fill="white"/>' +
  '</svg>',
)}`

const TWINT_LOGO_URL = "https://assets.raisenow.io/twint-logo-dark.svg"

export interface MethodPanelProps {
  paymentData: PaymentData
  totalPrice: number
  /** Releases the commit gate (see `commitGateHint`). Sticky once called. */
  onCommitUnlocked: () => void
}

export interface PaymentMethodUi {
  icon: ReactNode
  /** Render the tab icon on the brand's dark chip (TWINT styleguide). */
  darkIconChip?: boolean
  commitLabel: string
  Panel: (props: MethodPanelProps) => ReactNode
  /**
   * When set, the commit button stays disabled until the panel calls
   * `onCommitUnlocked`, and this hint explains why.
   */
  commitGateHint?: string
  /** False when the server sent nothing to pay with (integration off). */
  isAvailable?: (paymentData: PaymentData) => boolean
}

export const PAYMENT_METHOD_UI: Record<PaymentMethod, PaymentMethodUi> = {
  rechnung: {
    icon: <FileText className="h-5 w-5" strokeWidth={1.6} />,
    commitLabel: "Ich zahle die QR-Rechnung & Werkstatt verlassen",
    Panel: RechnungPanel,
  },
  monthly: {
    icon: <CalendarMark />,
    commitLabel: "Auf Sammelrechnung setzen & Werkstatt verlassen",
    Panel: MonthlyPanel,
  },
  raisenow: {
    icon: <img src={TWINT_LOGO_URL} alt="" className="h-5 w-auto" />,
    darkIconChip: true,
    commitLabel: "Ich habe via TWINT bezahlt & Werkstatt verlassen",
    Panel: RaisenowPanel,
    // Issue #537: the TWINT pay-link and the commit button sit close
    // together, and committing unmounts the picker — a user who hits "Ich
    // habe via TWINT bezahlt" first is dropped on the completion screen
    // with no way back to the paylink, so the payment can never be started.
    //
    // This gates on *intent*, not completion: we cannot observe whether the
    // RaiseNow payment actually succeeded. The paylink opens on
    // pay.raisenow.io, a foreign origin, so the same-origin policy forbids
    // reading that tab's URL (the kiosk manages it only because Electron's
    // main process sits outside the web sandbox — see
    // shared/src/kiosk-navigation.ts + checkout-kiosk/src/main.ts), and
    // RaiseNow's free plan offers no webhook (ADR-0020).
    commitGateHint: "Starte zuerst die TWINT-Zahlung.",
    isAvailable: (paymentData) => !!paymentData.paylinkUrl,
  },
}

/** Label for a method tab — the shared, brand-level label. */
export function paymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_INFO[method].label
}

/**
 * Kiosk RaiseNow auto-confirm (#416): when the customer completes the TWINT
 * payment in the kiosk overlay, the Electron bridge fires
 * `onPaymentConfirmed`. `onConfirmed` then records the same customer-stated
 * acknowledgement the manual commit button would — it does not mark the
 * bill paid; `paidAt` only comes from the statement import. No-op in a
 * normal browser (no bridge) and while `enabled` is false.
 */
export function useRaisenowKioskConfirm(
  enabled: boolean,
  onConfirmed: (paymentUuid: string) => void,
) {
  const bridge = useBridge()
  // Stash the latest callback in a ref so the subscription stays keyed on
  // the bridge only and doesn't re-subscribe per render.
  const confirmRef = useRef(onConfirmed)
  confirmRef.current = onConfirmed
  const handle = useCallback((paymentUuid: string) => {
    confirmRef.current(paymentUuid)
  }, [])
  useEffect(() => {
    if (!enabled || !bridge.available) return
    return bridge.onPaymentConfirmed(handle)
  }, [enabled, bridge.available, bridge.onPaymentConfirmed, handle])
}

// ---------------------------------------------------------------------------
// Method panels
// ---------------------------------------------------------------------------

function RechnungPanel({ paymentData, totalPrice }: MethodPanelProps) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-foreground leading-relaxed max-w-2xl">
        Bezahle via die QR-Rechnung über{" "}
        <strong className="text-foreground">{formatCHF(totalPrice)}</strong>,
        welche wir dir
        {paymentData.payerEmail && (
          <>
            {" "}
            an{" "}
            <strong className="text-foreground">
              {paymentData.payerEmail}
            </strong>
          </>
        )}{" "}
        geschickt haben. Oder scanne den QR-Code gleich jetzt mit deiner
        E-Banking App.
      </p>

      <div className="flex flex-col sm:flex-row gap-6">
        <div
          data-testid="payment-qr"
          className="shrink-0 rounded-md border border-border p-3 bg-white self-start"
        >
          <QRCodeSVG
            value={paymentData.qrBillPayload}
            size={180}
            level="M"
            imageSettings={{
              src: SWISS_CROSS_SVG,
              height: 34,
              width: 34,
              excavate: true,
            }}
          />
        </div>

        <div className="flex flex-col gap-4 text-sm min-w-0">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Konto / Zahlbar an
            </p>
            <p className="font-mono">{paymentData.creditor.iban}</p>
            <p>{paymentData.creditor.name}</p>
            {paymentData.creditor.street && (
              <p className="text-muted-foreground">
                {paymentData.creditor.street}
              </p>
            )}
            <p className="text-muted-foreground">
              {paymentData.creditor.location}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Referenz
            </p>
            <p className="font-mono">{paymentData.reference}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function MonthlyPanel({ totalPrice }: MethodPanelProps) {
  return (
    <p className="text-sm text-foreground leading-relaxed max-w-2xl">
      Die <strong>{formatCHF(totalPrice)}</strong> werden deiner
      Sammelrechnung hinzugefügt. Du erhältst am{" "}
      <strong>1. des nächsten Monats</strong> eine QR-Rechnung über alle
      offenen Posten.
    </p>
  )
}

function RaisenowPanel({
  paymentData,
  totalPrice,
  onCommitUnlocked,
}: MethodPanelProps) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-foreground leading-relaxed max-w-2xl">
        Bezahle <strong>{formatCHF(totalPrice)}</strong> sofort vom Handy —
        TWINT öffnet sich automatisch, bestätige die Zahlung in der App.
      </p>

      <a
        href={paymentData.paylinkUrl ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onCommitUnlocked}
        className="inline-flex items-center justify-center w-[270px] h-[56px] px-[35px] bg-[#262626] rounded-[6px] hover:bg-[#333333] active:bg-[#1a1a1a] transition-colors no-underline"
      >
        <img
          src={TWINT_LOGO_URL}
          alt=""
          className="h-[36px] w-[32px] mr-[20px] shrink-0"
        />
        <span className="text-[17px] font-medium text-white whitespace-nowrap">
          Mit TWINT bezahlen
        </span>
      </a>
    </div>
  )
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
