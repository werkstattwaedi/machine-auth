// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react"
import { formatCHF } from "@modules/lib/format"
import { useDocument } from "@modules/lib/firestore"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { checkoutRef } from "@modules/lib/firestore-helpers"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { httpsCallable } from "firebase/functions"
import {
  Copy,
  Download,
  Loader2,
  Smartphone,
  TriangleAlert,
} from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"
import type { PaymentMethod } from "./use-checkout-state"

export interface PaymentData {
  /** Doc id of the underlying bill — drives the PDF download action. */
  billId: string
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
  /** Null for the anonymous flow, where the client never sees the doc id. */
  checkoutId: string | null
  totalPrice: number
  resetLabel?: string
  onReset: () => void
  /**
   * Pre-fetched payment data from `closeCheckoutAndGetPayment`. When provided,
   * the QR renders immediately without waiting for the Firestore-trigger /
   * `getPaymentQrData` round-trip used by the legacy fallback path.
   */
  initialPaymentData?: PaymentData | null
  /** Method picked on Step 3; selects which single flow Step 4 renders. */
  selectedMethod: PaymentMethod
}

export function PaymentResult({
  checkoutId,
  totalPrice,
  resetLabel,
  onReset,
  initialPaymentData,
  selectedMethod,
}: PaymentResultProps) {
  const db = useDb()
  const functions = useFunctions()
  const qrFallbackMutation = useAsyncMutation<PaymentData>({
    context: "checkout.paymentQrFallback",
    errorMessage: "QR-Code konnte nicht geladen werden",
  })

  const [paymentData, setPaymentData] = useState<PaymentData | null>(
    initialPaymentData ?? null,
  )
  const [qrError, setQrError] = useState(false)

  // Legacy fallback: subscribe to billRef on the checkout doc and fetch
  // payment data once the Firestore trigger has created the bill. Skipped
  // when initialPaymentData is supplied (the normal flow now), and also
  // skipped when no checkoutId is available.
  const skipFallback = !!initialPaymentData || !checkoutId
  const { data: checkout } = useDocument(
    skipFallback || !checkoutId ? null : checkoutRef(db, checkoutId),
  )
  const billIdFromCheckout = checkout?.billRef?.id ?? null

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

  if (selectedMethod === "twint") {
    return (
      <TwintFlow
        paymentData={paymentData}
        totalPrice={totalPrice}
        resetLabel={resetLabel}
        onReset={onReset}
      />
    )
  }

  return (
    <RechnungFlow
      paymentData={paymentData}
      totalPrice={totalPrice}
      functions={functions}
      resetLabel={resetLabel}
      onReset={onReset}
    />
  )
}

// ---------------------------------------------------------------------------
// Rechnung flow — QR-bill scanning + PDF download / IBAN copy
// ---------------------------------------------------------------------------

interface FlowProps {
  paymentData: PaymentData
  totalPrice: number
  resetLabel?: string
  onReset: () => void
}

interface RechnungFlowProps extends FlowProps {
  functions: import("firebase/functions").Functions
}

function RechnungFlow({
  paymentData,
  totalPrice,
  functions,
  resetLabel,
  onReset,
}: RechnungFlowProps) {
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
      // Copy the unspaced form so it pastes cleanly into banking apps.
      const compact = paymentData.creditor.iban.replace(/\s/g, "")
      await navigator.clipboard.writeText(compact)
      toast.success("IBAN kopiert")
    } catch {
      toast.error("Kopieren fehlgeschlagen")
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold font-heading mb-2">
          QR-Rechnung scannen
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
          Wir haben dir die Rechnung über{" "}
          <strong className="text-foreground">{formatCHF(totalPrice)}</strong>
          {paymentData.payerEmail && (
            <>
              {" "}
              an{" "}
              <strong className="text-foreground">
                {paymentData.payerEmail}
              </strong>
            </>
          )}{" "}
          geschickt. Bezahle sie mit dem QR-Code auf der Rechnung — oder gleich
          jetzt, indem du den Code unten mit deiner E-Banking App scannst.
        </p>
      </div>

      <QrBillCard data={paymentData} />

      <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
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

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors"
        >
          {resetLabel ?? "Fertig"}
        </button>
      </div>
    </div>
  )
}

function QrBillCard({ data }: { data: PaymentData }) {
  return (
    <div className="rounded-md border border-border bg-white p-5 sm:p-6">
      <div className="flex flex-col sm:flex-row gap-6">
        <div className="shrink-0">
          <QRCodeSVG
            value={data.qrBillPayload}
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

        <div className="flex flex-col gap-4 text-xs sm:text-sm min-w-0">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Konto / Zahlbar an
            </p>
            <p className="font-mono">{data.creditor.iban}</p>
            <p>{data.creditor.name}</p>
            {data.creditor.street && (
              <p className="text-muted-foreground">{data.creditor.street}</p>
            )}
            <p className="text-muted-foreground">{data.creditor.location}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Referenz
            </p>
            <p className="font-mono">{data.reference}</p>
          </div>
          {data.payerName && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Zahlbar durch
              </p>
              <p>{data.payerName}</p>
              {data.payerEmail && (
                <p className="text-muted-foreground">{data.payerEmail}</p>
              )}
            </div>
          )}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Betrag
            </p>
            <p className="text-muted-foreground">{data.currency}</p>
            <p className="font-heading font-bold text-2xl tabular-nums">
              {data.amount}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TWINT flow — single big button + transaction-fee notice
// ---------------------------------------------------------------------------

function TwintFlow({
  paymentData,
  totalPrice,
  resetLabel,
  onReset,
}: FlowProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold font-heading mb-2">
          Mit TWINT bezahlen
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
          Total <strong className="text-foreground">{formatCHF(totalPrice)}</strong>.
          Tippe auf den Button und bestätige die Zahlung in deiner TWINT-App.
        </p>
      </div>

      <div className="rounded-md border border-border bg-secondary p-8 sm:p-10 flex flex-col items-center gap-3">
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

      <div className="flex items-start gap-2 rounded-md bg-cog-teal-light text-cog-teal-dark px-4 py-3 text-sm">
        <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          Bei TWINT fallen Transaktionsgebühren an, die der Verein trägt.
        </span>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors"
        >
          {resetLabel ?? "Fertig"}
        </button>
      </div>
    </div>
  )
}
