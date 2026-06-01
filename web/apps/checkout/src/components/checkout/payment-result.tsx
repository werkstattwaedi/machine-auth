// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Step 4 (Bezahlen) — payment-method picker as a G4 vertical-tab layout.
 *
 * The user picks one of three methods (rechnung / monthly [members only] /
 * twint — UI labels are German). The click writes the
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
import { rpcCallable } from "@modules/lib/rpc"
import { CheckCircle2, Download, FileText, Loader2 } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
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
  /** Gates the monthly-bill (Sammelrechnung) tab — only Vereinsmitglieder
   *  see it; the Firestore rule also requires activeMembership. */
  isMember: boolean
}

const COMMIT_LABELS: Record<PaymentMethod, string> = {
  rechnung: "Ich zahle die QR-Rechnung & Werkstatt verlassen",
  monthly: "Auf Sammelrechnung setzen & Werkstatt verlassen",
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
  // Fire-and-forget writes of the user's last-selected tab on the
  // checkout doc. The commit-time ack itself flows through the callable
  // below (acknowledgeBill on the bill).
  const tabSelectionMutation = useFirestoreMutation()
  const ackMutation = useAsyncMutation<{ ok: true }>({
    context: "checkout.acknowledgeBill",
    errorMessage: "Bestätigung konnte nicht gespeichert werden",
  })
  const downloadMutation = useAsyncMutation<{ url: string }>({
    context: "checkout.downloadInvoice",
    errorMessage: "PDF konnte nicht geladen werden",
  })

  const [paymentData, setPaymentData] = useState<PaymentData | null>(
    initialPaymentData ?? null,
  )
  const [qrError, setQrError] = useState(false)
  const [tab, setTab] = useState<PaymentMethod>("rechnung")

  // Issue #237: a CHF 0 visit ("Interne Nutzung") has nothing payable —
  // skip the QR/PayLink dance entirely and render a "nichts zu bezahlen"
  // screen below. We never fetch payment data, never render a QR, never
  // pick a method.
  const isFree = totalPrice === 0

  // Legacy fallback: subscribe to billRef on the checkout doc and fetch
  // payment data once the Firestore trigger has created the bill. Skipped
  // when initialPaymentData is supplied (the normal flow now), also
  // skipped when no checkoutId is available, and skipped for free visits
  // (nothing to load).
  const skipFallback = !!initialPaymentData || !checkoutId || isFree
  const { data: checkout } = useDocument(
    skipFallback || !checkoutId ? null : checkoutRef(db, checkoutId),
  )
  const billIdFromCheckout = checkout?.billRef?.id ?? null

  useEffect(() => {
    if (skipFallback || !billIdFromCheckout) return

    const getPaymentData = rpcCallable<{ billId: string }, PaymentData>(
      functions,
      "billingCall",
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

  // Persist the user's last-selected tab on the checkout doc so the
  // workshop has a record of intent even if the user closes the tab.
  // Fire-and-forget; the commit-time callable also stamps the field.
  const persistedCheckoutId = paymentData?.checkoutId ?? checkoutId
  useEffect(() => {
    if (!persistedCheckoutId || isFree) return
    void tabSelectionMutation.update(
      checkoutRef(db, persistedCheckoutId),
      { paymentMethod: tab },
    )
    // `db` and `tabSelectionMutation` are stable singletons / hook
    // results from a useFunctions provider — re-firing on every render
    // would re-write the same value with no observable benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedCheckoutId, tab])

  if (isFree) {
    return (
      <div className="space-y-6">
        <div className="rounded-md border border-border bg-background px-6 py-7">
          <div className="flex items-start gap-4">
            <CheckCircle2
              className="h-10 w-10 text-cog-teal shrink-0"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="font-heading font-bold text-2xl sm:text-3xl leading-tight text-foreground">
                Keine Zahlung erforderlich
              </div>
              <p className="mt-2 text-sm text-foreground leading-relaxed max-w-2xl">
                Diese Nutzung ist kostenlos &mdash; du musst nichts bezahlen.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors"
          >
            Werkstatt verlassen
          </button>
        </div>
      </div>
    )
  }

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

  const handleDownloadPdf = async () => {
    try {
      const callable = rpcCallable<{ billId: string }, { url: string }>(
        functions,
        "billingCall",
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

  const handleCommit = async () => {
    // paymentData is non-null here (the !paymentData early return above
    // guards this block). The callable stamps
    // paymentMethodConfirmationTime on the bill, which the onBillUpdate
    // trigger then keys the invoice email + membership activation off
    // (issues #251, #302).
    try {
      const callable = rpcCallable<
        { billId: string; paymentMethod: PaymentMethod },
        { ok: true }
      >(functions, "billingCall", "acknowledgeBill")
      await ackMutation.mutate(async () => {
        const res = await callable({
          billId: paymentData.billId,
          paymentMethod: tab,
        })
        return res.data
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
      {/* Hero — "Zu bezahlen" + amount + lightweight PDF download.
          Details of the bill were shown in step 3. */}
      <div className="rounded-md border border-border bg-background px-6 py-7 flex items-end justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Zu bezahlen
          </div>
          <div className="mt-2 font-heading font-bold text-5xl tabular-nums leading-none text-foreground">
            <span className="text-base font-semibold uppercase text-muted-foreground mr-3 align-baseline">
              CHF
            </span>
            {totalPrice.toFixed(2)}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={downloadMutation.loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-md transition-colors disabled:opacity-50"
        >
          {downloadMutation.loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Rechnung als PDF
        </button>
      </div>

      {/* Vertical tabs — teal left rail on the active option */}
      <div role="tablist" aria-label="Zahlungsmethode" className="flex flex-col gap-1.5">
        <MethodTab
          id="rechnung"
          active={tab}
          onSelect={setTab}
          icon={<FileText className="h-5 w-5" strokeWidth={1.6} />}
          label="QR-Rechnung"
        />
        {isMember && (
          <MethodTab
            id="monthly"
            active={tab}
            onSelect={setTab}
            icon={<CalendarMark />}
            label="Sammelrechnung"
          />
        )}
        <MethodTab
          id="twint"
          active={tab}
          onSelect={setTab}
          icon={
            <img
              src="https://assets.raisenow.io/twint-logo-dark.svg"
              alt=""
              className="h-5 w-auto"
            />
          }
          label="TWINT"
        />
      </div>

      {/* Method-specific instruction panel.
          The outer container animates its height between methods (relies on
          the global `interpolate-size: allow-keywords` set in
          modules/index.css and `overflow-hidden` so content clips smoothly
          during the resize). The inner `key={tab}` block re-mounts on tab
          change so tw-animate-css fades the new content in. */}
      <div className="rounded-md border border-border bg-white p-5 sm:p-7 overflow-hidden transition-[height] duration-200 ease-out">
        <div key={tab} className="animate-in fade-in duration-150">
          {tab === "rechnung" && (
            <RechnungPanel paymentData={paymentData} totalPrice={totalPrice} />
          )}
          {tab === "monthly" && <MonthlyPanel totalPrice={totalPrice} />}
          {tab === "twint" && (
            <TwintPanel paymentData={paymentData} totalPrice={totalPrice} />
          )}
        </div>
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
  label: string
}

function MethodTab({ id, active, onSelect, icon, label }: MethodTabProps) {
  const on = id === active
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={() => onSelect(id)}
      className={cn(
        "w-full flex items-center gap-4 text-left rounded-lg border border-border bg-white px-4 sm:px-5 py-3.5 transition-colors",
        // Active rail painted as inset box-shadow so it doesn't shift content
        // (border-l-4 swaps would push the row 3px right when activated).
        on
          ? "bg-cog-teal-light border-cog-teal/60 shadow-[inset_4px_0_0_0_var(--color-cog-teal)]"
          : "hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "shrink-0 flex h-9 w-9 items-center justify-center rounded-md transition-all",
          // TWINT styleguide mandates its logo on a dark surface — keep it
          // as a brand chip. Our own methods (rechnung, monthly) sit on a
          // neutral gray so the row doesn't read as three ad slots.
          id === "twint"
            ? "bg-[#262626] text-white"
            : "bg-muted text-foreground/80",
          on && "ring-2 ring-cog-teal shadow-sm scale-110",
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          "min-w-0 font-heading font-semibold text-[15px] leading-tight",
          on ? "text-cog-teal-dark" : "text-foreground",
        )}
      >
        {label}
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

function MonthlyPanel({ totalPrice }: { totalPrice: number }) {
  return (
    <p className="text-sm text-foreground leading-relaxed max-w-2xl">
      Die <strong>{formatCHF(totalPrice)}</strong> werden deiner
      Sammelrechnung hinzugefügt. Du erhältst am{" "}
      <strong>1. des nächsten Monats</strong> eine QR-Rechnung über alle
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

