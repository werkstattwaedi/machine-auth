// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Step 4 (Bezahlen) — payment-method picker as a G4 vertical-tab layout.
 *
 * The tabs are the methods enabled for this client type (kiosk / web,
 * operations config) that the customer is eligible for — today rechnung,
 * monthly [members only] and raisenow (TWINT paylink). Method-specific UI
 * lives in `payment-methods.tsx`. The commit click writes the
 * customer-stated acknowledgement to the bill and unmounts.
 *
 * No back button — once the checkout is closed the user cannot rewind.
 */

import { useEffect, useState } from "react"
import { useDocument } from "@modules/lib/firestore"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { checkoutRef } from "@modules/lib/firestore-helpers"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { rpcCallable } from "@modules/lib/rpc"
import { CheckCircle2, Download, Loader2 } from "lucide-react"
import { cn } from "@modules/lib/utils"
import {
  enabledPaymentMethods,
  type ClientType,
  type PaymentMethod,
  type PaymentMethodConfig,
} from "@oww/shared"
import { paymentMethodConfig } from "@/lib/payment-config"
import {
  PAYMENT_METHOD_UI,
  paymentMethodLabel,
  useRaisenowKioskConfirm,
  type PaymentData,
} from "./payment-methods"

export type { PaymentData } from "./payment-methods"
export { SWISS_CROSS_SVG } from "./payment-methods"

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
   *  see it. Derived from both identification modes upstream
   *  (`wizard-context` deriveIsMember), so tag-tapping members get it too
   *  (issue #414). The server refuses `monthly` for a non-member too
   *  (`assertPaymentMethodAllowed`, #750), keyed on the same
   *  `activeMembership`. */
  isMember: boolean
  /**
   * Where the checkout runs. Picks the configured method list, and on the
   * shared kiosk machine hides the "Rechnung als PDF" download — we don't
   * want invoices downloaded to the kiosk's local disk (issue #418). The
   * customer still gets the invoice by email.
   */
  clientType: ClientType
  /** Overrides the build-time method config (tests). */
  methodConfig?: PaymentMethodConfig
}

export function PaymentResult({
  checkoutId,
  totalPrice,
  onReset,
  initialPaymentData,
  isMember,
  clientType,
  methodConfig = paymentMethodConfig,
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

  // The QR bill is the fallback of last resort: it needs nothing beyond the
  // bill itself, so even an empty configured list leaves a way to pay.
  const configured = enabledPaymentMethods(methodConfig, clientType, { isMember })
  const methods = (configured.length > 0 ? configured : ["rechnung" as const]).filter(
    (m) => !paymentData || (PAYMENT_METHOD_UI[m].isAvailable?.(paymentData) ?? true),
  )
  const [selectedTab, setTab] = useState<PaymentMethod>(methods[0] ?? "rechnung")
  // Guard against a selection that dropped out (e.g. no paylink in the
  // payment data that arrived through the fallback path).
  const tab = methods.includes(selectedTab) ? selectedTab : (methods[0] ?? "rechnung")

  // Commit gates released by their panel (#537). Sticky: they survive tab
  // switches so a user who already paid and is browsing the other methods
  // isn't re-gated on return.
  const [unlocked, setUnlocked] = useState<ReadonlySet<PaymentMethod>>(new Set())

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

  const billIdForConfirm = paymentData?.billId ?? null
  useRaisenowKioskConfirm(methods.includes("raisenow"), (paymentUuid) => {
    if (!billIdForConfirm) return
    const callable = rpcCallable<
      { billId: string; paymentMethod: PaymentMethod },
      { ok: true }
    >(functions, "billingCall", "acknowledgeBill")
    ackMutation
      .mutate(async () => {
        const res = await callable({
          billId: billIdForConfirm,
          paymentMethod: "raisenow",
        })
        return res.data
      })
      .then(() => onReset())
      .catch(() => {
        // Hook already toasted + telemetered. The overlay confirmation page
        // stays visible; the user can still use the manual commit button.
        console.error("RaiseNow auto-confirm failed", paymentUuid)
      })
  })

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

  const active = PAYMENT_METHOD_UI[tab]
  const commitGated = !!active.commitGateHint && !unlocked.has(tab)

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
        {/* Hidden on the kiosk (issue #418): the shared machine must not
            download invoice PDFs to its local disk. */}
        {clientType !== "kiosk" && (
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
        )}
      </div>

      {/* Vertical tabs — teal left rail on the active option */}
      <div role="tablist" aria-label="Zahlungsmethode" className="flex flex-col gap-1.5">
        {methods.map((m) => (
          <MethodTab
            key={m}
            id={m}
            active={tab}
            onSelect={setTab}
            icon={PAYMENT_METHOD_UI[m].icon}
            darkIconChip={PAYMENT_METHOD_UI[m].darkIconChip ?? false}
            label={paymentMethodLabel(m)}
          />
        ))}
      </div>

      {/* Method-specific instruction panel.
          The outer container animates its height between methods (relies on
          the global `interpolate-size: allow-keywords` set in
          modules/index.css and `overflow-hidden` so content clips smoothly
          during the resize). The inner `key={tab}` block re-mounts on tab
          change so tw-animate-css fades the new content in. */}
      <div className="rounded-md border border-border bg-white p-5 sm:p-7 overflow-hidden transition-[height] duration-200 ease-out">
        <div key={tab} className="animate-in fade-in duration-150">
          <active.Panel
            paymentData={paymentData}
            totalPrice={totalPrice}
            onCommitUnlocked={() =>
              setUnlocked((prev) => new Set(prev).add(tab))
            }
          />
        </div>
      </div>

      {/* Single commit button — no back. Acknowledgement is recorded on click.
          Methods with a commit gate (TWINT: the paylink must be opened first,
          #537) keep it disabled until their panel releases it. */}
      <div className="flex flex-col items-end gap-2 pt-2">
        <button
          type="button"
          onClick={handleCommit}
          disabled={ackMutation.loading || commitGated}
          aria-describedby={commitGated ? "commit-gate-hint" : undefined}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {ackMutation.loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {active.commitLabel}
        </button>
        {commitGated && (
          <p id="commit-gate-hint" className="text-xs text-muted-foreground">
            {active.commitGateHint}
          </p>
        )}
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
  darkIconChip: boolean
  label: string
}

function MethodTab({ id, active, onSelect, icon, darkIconChip, label }: MethodTabProps) {
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
          darkIconChip
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
