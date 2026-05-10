// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Step 4 (Bezahlen) — payment-method picker as a G4 vertical-tab layout.
 *
 * The user picks one of three methods (QR-Rechnung / Sammelrechnung [members
 * only] / TWINT) and clicks the commit button. The click writes the
 * customer-stated acknowledgement to the checkout doc and unmounts.
 *
 * No back button — once the checkout is closed the user cannot rewind.
 */

import { useEffect, useState } from "react"
import { formatCHF } from "@modules/lib/format"
import { useDocument } from "@modules/lib/firestore"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { checkoutRef } from "@modules/lib/firestore-helpers"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { httpsCallable } from "firebase/functions"
import { serverTimestamp } from "firebase/firestore"
import {
  ArrowRight,
  Copy,
  Download,
  FileText,
  Loader2,
  Smartphone,
} from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"
import { cn } from "@modules/lib/utils"
import type { PaymentMethod } from "./use-checkout-state"

export interface PaymentData {
  /** Doc id of the underlying bill — drives the PDF download action. */
  billId: string
  /** Doc id of the checkout — used to record the customer's payment-method
   *  acknowledgement once they pick a method and click the commit button. */
  checkoutId: string | null
  qrBillPayload: string
  paylinkUrl: string
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

interface PaymentResultProps {
  /** Closed checkout doc id. Always set on the new flow (the callable
   *  threads it back through PaymentData), but typed as nullable so the
   *  loading-fallback path stays renderable while we wait for it. */
  checkoutId: string | null
  totalPrice: number
  /** Fired after the ack write completes. Wizard owns the navigation. */
  onReset: () => void
  /**
   * Pre-fetched payment data from `closeCheckoutAndGetPayment`. When
   * provided, the QR renders immediately without waiting for the
   * Firestore-trigger / `getPaymentQrData` round-trip used by the legacy
   * fallback path.
   */
  initialPaymentData?: PaymentData | null
  /** Gates the Sammelrechnung tab — only Vereinsmitglieder see it. */
  isMember: boolean
}

const COMMIT_LABELS: Record<PaymentMethod, string> = {
  rechnung: "Ich zahle die QR-Rechnung & Werkstatt verlassen",
  sammel: "Auf Sammelrechnung setzen & Werkstatt verlassen",
  twint: "Ich habe via TWINT bezahlt & Werkstatt verlassen",
}

export function PaymentResult({
  checkoutId,
  totalPrice,
  onReset,
  initialPaymentData,
  isMember,
}: PaymentResultProps) {
  const db = useDb()
  const functions = useFunctions()
  const qrFallbackMutation = useAsyncMutation<PaymentData>({
    context: "checkout.paymentQrFallback",
    errorMessage: "QR-Code konnte nicht geladen werden",
  })
  const ackMutation = useFirestoreMutation()

  const [paymentData, setPaymentData] = useState<PaymentData | null>(
    initialPaymentData ?? null,
  )
  const [qrError, setQrError] = useState(false)
  const [tab, setTab] = useState<PaymentMethod>("rechnung")

  // Legacy fallback: subscribe to billRef on the checkout doc and fetch
  // payment data once the Firestore trigger has created the bill. Skipped
  // when initialPaymentData is supplied (the normal flow now), and also
  // skipped when no checkoutId is available.
  const skipFallback = !!initialPaymentData || !checkoutId
  const { data: checkout } = useDocument(
    skipFallback || !checkoutId ? null : checkoutRef(db, checkoutId),
  )
  const billIdFromCheckout = checkout?.billRef?.id ?? null
  const effectiveCheckoutId = paymentData?.checkoutId ?? checkoutId

  useEffect(() => {
    if (skipFallback || !billIdFromCheckout) return

    const getPaymentData = httpsCallable<{ billId: string }, PaymentData>(
      functions,
      "getPaymentQrData",
    )

    qrFallbackMutation
      .mutate(async () => {
        const result = await getPaymentData({ billId: billIdFromCheckout })
        return result.data
      })
      .then((data) => setPaymentData(data))
      .catch(() => {
        setQrError(true)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipFallback, billIdFromCheckout, functions])

  if (qrError) {
    return (
      <p className="text-sm text-destructive">
        QR-Code konnte nicht geladen werden.
      </p>
    )
  }

  if (!paymentData) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        QR-Code wird geladen...
      </div>
    )
  }

  const handleCommit = async () => {
    if (!effectiveCheckoutId) {
      toast.error("Checkout-ID fehlt, Bestätigung kann nicht gespeichert werden.")
      return
    }
    try {
      await ackMutation.update(checkoutRef(db, effectiveCheckoutId), {
        paymentMethodConfirmed: tab,
        paymentMethodConfirmedAt: serverTimestamp(),
      })
    } catch {
      // Hook already toasted + telemetered. Keep the user on the page so
      // they can retry rather than dropping them out without a record.
      return
    }
    onReset()
  }

  return (
    <div className="space-y-6">
      {/* Hero — "Zu bezahlen" + amount. Details were shown in step 3. */}
      <div className="rounded-md border border-border bg-cog-teal-light px-6 py-7 text-center">
        <div className="text-[11px] font-bold uppercase tracking-wider text-cog-teal-dark">
          Zu bezahlen
        </div>
        <div className="mt-2 font-heading font-bold text-5xl tabular-nums leading-none text-foreground">
          <span className="text-2xl font-semibold text-cog-teal-dark mr-2 align-middle">
            CHF
          </span>
          {totalPrice.toFixed(2)}
        </div>
      </div>

      {/* Vertical tabs — teal left rail on the active option */}
      <div role="tablist" aria-label="Zahlungsmethode" className="flex flex-col gap-1.5">
        <MethodTab
          id="rechnung"
          active={tab}
          onSelect={setTab}
          icon={<FileText className="h-5 w-5" strokeWidth={1.6} />}
          activeMarkClass="bg-cog-teal-light text-cog-teal-dark"
          label="QR-Rechnung"
          sub="Per E-Mail · 30 Tage"
        />
        {isMember && (
          <MethodTab
            id="sammel"
            active={tab}
            onSelect={setTab}
            icon={<CalendarMark />}
            activeMarkClass="bg-oww-gold-light text-oww-gold-text"
            label="Sammelrechnung"
            sub="Mitglieder · monatlich"
          />
        )}
        <MethodTab
          id="twint"
          active={tab}
          onSelect={setTab}
          icon={<TwintGlyph />}
          activeMarkClass="bg-[#ecedf2] text-[#16284e]"
          label="TWINT"
          sub="Sofort vom Handy"
        />
      </div>

      {/* Method-specific instruction panel */}
      <div className="rounded-md border border-border bg-white p-5 sm:p-7">
        {tab === "rechnung" && (
          <RechnungPanel paymentData={paymentData} totalPrice={totalPrice} />
        )}
        {tab === "sammel" && <SammelPanel totalPrice={totalPrice} />}
        {tab === "twint" && (
          <TwintPanel paymentData={paymentData} totalPrice={totalPrice} />
        )}
      </div>

      {/* Single commit button — no back. Acknowledgement is recorded on click. */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleCommit}
          disabled={ackMutation.loading}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors disabled:opacity-50"
        >
          {ackMutation.loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {COMMIT_LABELS[tab]}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vertical tab card
// ---------------------------------------------------------------------------

interface MethodTabProps {
  id: PaymentMethod
  active: PaymentMethod
  onSelect: (m: PaymentMethod) => void
  icon: React.ReactNode
  /** Tailwind classes applied to the icon wrapper when this tab is active. */
  activeMarkClass: string
  label: string
  sub: string
}

function MethodTab({
  id,
  active,
  onSelect,
  icon,
  activeMarkClass,
  label,
  sub,
}: MethodTabProps) {
  const on = id === active
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={() => onSelect(id)}
      className={cn(
        "w-full flex items-center gap-4 text-left rounded-lg border border-border bg-white px-4 sm:px-5 py-3.5 transition-colors",
        // 4px left rail, transparent until active
        "border-l-4 border-l-transparent",
        on
          ? "bg-cog-teal-light border-cog-teal/45 border-l-cog-teal"
          : "hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "shrink-0 flex h-9 w-9 items-center justify-center rounded-md transition-colors",
          on ? activeMarkClass : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex flex-col gap-0.5">
        <span
          className={cn(
            "font-heading font-semibold text-[15px] leading-tight",
            on ? "text-cog-teal-dark" : "text-foreground",
          )}
        >
          {label}
        </span>
        <span className="text-[12px] text-muted-foreground leading-tight">
          {sub}
        </span>
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Method panels
// ---------------------------------------------------------------------------

function RechnungPanel({
  paymentData,
  totalPrice,
}: {
  paymentData: PaymentData
  totalPrice: number
}) {
  const functions = useFunctions()
  const downloadMutation = useAsyncMutation<{ url: string }>({
    context: "checkout.downloadInvoice",
    errorMessage: "PDF konnte nicht geladen werden",
  })

  const handleDownloadPdf = async () => {
    try {
      const callable = httpsCallable<{ billId: string }, { url: string }>(
        functions,
        "getInvoiceDownloadUrl",
      )
      const data = await downloadMutation.mutate(async () => {
        const res = await callable({ billId: paymentData.billId })
        return res.data
      })
      window.open(data.url, "_blank", "noopener,noreferrer")
    } catch {
      // toast already fired by the hook
    }
  }

  const handleCopyIban = async () => {
    try {
      const compact = paymentData.creditor.iban.replace(/\s/g, "")
      await navigator.clipboard.writeText(compact)
      toast.success("IBAN kopiert")
    } catch {
      toast.error("Kopieren fehlgeschlagen")
    }
  }

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
        <div className="shrink-0 rounded-md border border-border p-3 bg-white self-start">
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

      <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-dashed border-border">
        <p className="flex items-center gap-2 text-sm text-muted-foreground max-w-md">
          <Smartphone className="h-4 w-4 shrink-0" />
          Mit deiner Banking-App scannen — oder später per E-Mail bezahlen.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={downloadMutation.loading}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-cog-teal border border-cog-teal rounded-[3px] bg-white hover:bg-cog-teal-light transition-colors disabled:opacity-50"
          >
            {downloadMutation.loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            PDF herunterladen
          </button>
          <button
            type="button"
            onClick={handleCopyIban}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-cog-teal border border-cog-teal rounded-[3px] bg-white hover:bg-cog-teal-light transition-colors"
          >
            <Copy className="h-4 w-4" />
            IBAN kopieren
          </button>
        </div>
      </div>
    </div>
  )
}

function SammelPanel({ totalPrice }: { totalPrice: number }) {
  return (
    <p className="text-sm text-foreground leading-relaxed max-w-2xl">
      Wir setzen <strong>{formatCHF(totalPrice)}</strong> auf deine
      Sammelrechnung. Du erhältst am{" "}
      <strong>1. des nächsten Monats</strong> eine QR-Rechnung mit allen
      offenen Posten.
    </p>
  )
}

function TwintPanel({
  paymentData,
  totalPrice,
}: {
  paymentData: PaymentData
  totalPrice: number
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-foreground leading-relaxed max-w-2xl">
        Bezahle <strong>{formatCHF(totalPrice)}</strong> sofort vom Handy —
        TWINT öffnet sich automatisch, bestätige die Zahlung in der App.
      </p>

      <div className="flex flex-col items-start gap-3">
        <a
          href={paymentData.paylinkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center w-[270px] h-[56px] px-[35px] bg-[#262626] rounded-[6px] hover:bg-[#333333] active:bg-[#1a1a1a] transition-colors no-underline"
        >
          <img
            src="https://assets.raisenow.io/twint-logo-dark.svg"
            alt=""
            className="h-[36px] w-[32px] mr-[20px] shrink-0"
          />
          <span className="text-[17px] font-medium text-white whitespace-nowrap">
            Mit TWINT bezahlen
          </span>
        </a>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatCHF(totalPrice)} · Bestätigung in der App
        </p>
      </div>
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

/** Two-circle TWINT motif (recognizable, not the trademark logo). */
function TwintGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <circle cx="9" cy="12" r="5" fill="currentColor" />
      <circle cx="15" cy="12" r="5" fill="currentColor" fillOpacity="0.55" />
    </svg>
  )
}
