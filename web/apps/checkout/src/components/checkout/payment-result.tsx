// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react"
import { formatCHF } from "@modules/lib/format"
import { useDocument } from "@modules/lib/firestore"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { checkoutRef } from "@modules/lib/firestore-helpers"
import { httpsCallable } from "firebase/functions"
import { Loader2 } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"

export interface PaymentData {
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
  amount: string
  currency: string
}

type PaymentMethod = "ebanking" | "twint"

// Swiss cross SVG for QR bill center overlay (SIX Swiss Payment Standards spec):
// thin white border, black square, white cross.
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
}

export function PaymentResult({
  checkoutId,
  totalPrice,
  resetLabel,
  onReset,
  initialPaymentData,
}: PaymentResultProps) {
  const db = useDb()
  const functions = useFunctions()
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>("ebanking")

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
  const billId = checkout?.billRef?.id ?? null

  useEffect(() => {
    if (skipFallback || !billId) return

    const getPaymentData = httpsCallable<{ billId: string }, PaymentData>(
      functions,
      "getPaymentQrData",
    )

    getPaymentData({ billId })
      .then((result) => setPaymentData(result.data))
      .catch(() => setQrError(true))
  }, [skipFallback, billId, functions])

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Zu bezahlen</p>
        <h2 className="text-2xl font-bold font-body">{formatCHF(totalPrice)}</h2>
      </div>

      {paymentData ? (
        <div className="space-y-3">
          {/* E-Banking option */}
          <div>
            <button
              type="button"
              className={`w-full flex items-center gap-3 px-4 py-3 border rounded-t-[3px] text-left transition-colors ${
                selectedMethod === "ebanking"
                  ? "border-cog-teal bg-white"
                  : "border-border bg-white hover:bg-gray-50"
              } ${selectedMethod !== "ebanking" ? "rounded-b-[3px]" : "border-b-0"}`}
              onClick={() => setSelectedMethod("ebanking")}
            >
              <div className={`h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                selectedMethod === "ebanking" ? "border-cog-teal" : "border-gray-300"
              }`}>
                {selectedMethod === "ebanking" && (
                  <div className="h-2 w-2 rounded-full bg-cog-teal" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm">E-Banking</span>
                  <span className="text-xs text-muted-foreground">QR-Rechnung</span>
                </div>
                <p className="text-xs text-green-700">Gebührenfrei für den Verein</p>
              </div>
              <span className="text-[10px] font-medium text-cog-teal border border-cog-teal rounded px-1.5 py-0.5 uppercase tracking-wide shrink-0">
                Empfohlen
              </span>
            </button>

            {selectedMethod === "ebanking" && (
              <div className="border border-t-0 border-cog-teal rounded-b-[3px] bg-white px-4 py-4">
                <div className="flex gap-6">
                  <div className="shrink-0">
                    <QRCodeSVG
                      value={paymentData.qrBillPayload}
                      size={160}
                      level="M"
                      imageSettings={{
                        src: SWISS_CROSS_SVG,
                        height: 30,
                        width: 30,
                        excavate: true,
                      }}
                    />
                    <div className="flex gap-6 mt-3 text-xs">
                      <div>
                        <p className="font-bold">Währung</p>
                        <p>{paymentData.currency}</p>
                      </div>
                      <div>
                        <p className="font-bold">Betrag</p>
                        <p>{paymentData.amount}</p>
                      </div>
                    </div>
                  </div>

                  {/* Payment details */}
                  <div className="text-xs space-y-3 min-w-0">
                    <div>
                      <p className="font-bold">Konto / Zahlbar an</p>
                      <p>{paymentData.creditor.iban}</p>
                      <p>{paymentData.creditor.name}</p>
                      {paymentData.creditor.street && <p>{paymentData.creditor.street}</p>}
                      <p>{paymentData.creditor.location}</p>
                    </div>
                    <div>
                      <p className="font-bold">Referenz</p>
                      <p>{paymentData.reference}</p>
                    </div>
                    {paymentData.payerName && (
                      <div>
                        <p className="font-bold">Zahlbar durch</p>
                        <p>{paymentData.payerName}</p>
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Scanne den QR-Code mit deiner Banking-App.
                </p>
              </div>
            )}
          </div>

          {/* TWINT option */}
          <div>
            <button
              type="button"
              className={`w-full flex items-center gap-3 px-4 py-3 border rounded-t-[3px] text-left transition-colors ${
                selectedMethod === "twint"
                  ? "border-cog-teal bg-white"
                  : "border-border bg-white hover:bg-gray-50"
              } ${selectedMethod !== "twint" ? "rounded-b-[3px]" : "border-b-0"}`}
              onClick={() => setSelectedMethod("twint")}
            >
              <div className={`h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                selectedMethod === "twint" ? "border-cog-teal" : "border-gray-300"
              }`}>
                {selectedMethod === "twint" && (
                  <div className="h-2 w-2 rounded-full bg-cog-teal" />
                )}
              </div>
              <span className="font-bold text-sm">TWINT</span>
            </button>

            {selectedMethod === "twint" && (
              <div className="border border-t-0 border-cog-teal rounded-b-[3px] bg-white px-4 py-4">
                <div className="flex flex-col items-start gap-3">
                  <p className="text-xs text-muted-foreground">
                    Hinweis: Bei TWINT-Zahlungen fallen für die Werkstatt Transaktionsgebühren an.
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
              </div>
            )}
          </div>
        </div>
      ) : qrError ? (
        <p className="text-sm text-destructive">
          QR-Code konnte nicht geladen werden.
        </p>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          QR-Code wird geladen...
        </div>
      )}

      <div>
        <p className="text-sm font-bold">Zusammenfassung</p>
        <p className="text-sm text-muted-foreground">
          Die Rechnung wird dir per E-Mail zugeschickt.
        </p>
      </div>

      <button
        type="button"
        className="inline-flex items-center justify-center w-full gap-2 px-3 py-1.5 text-sm font-bold text-cog-teal border border-cog-teal rounded-[3px] bg-white hover:bg-cog-teal-light transition-colors"
        onClick={onReset}
      >
        {resetLabel ?? "Zurück zum Start"}
      </button>
    </div>
  )
}
