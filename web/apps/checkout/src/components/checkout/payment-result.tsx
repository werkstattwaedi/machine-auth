// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react"
import { formatCHF } from "@modules/lib/format"
import { useDocument } from "@modules/lib/firestore"
import { useFunctions } from "@modules/lib/firebase-context"
import { httpsCallable } from "firebase/functions"
import { CheckCircle, Loader2 } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import type { DocumentReference, Timestamp } from "firebase/firestore"

interface CheckoutDoc {
  billRef?: DocumentReference | null
}

interface BillDoc {
  referenceNumber: number
  amount: number
  paidAt: Timestamp | null
  paidVia: string | null
}

interface PaymentResultProps {
  checkoutId: string
  totalPrice: number
  resetLabel?: string
  onReset: () => void
}

export function PaymentResult({ checkoutId, totalPrice, resetLabel, onReset }: PaymentResultProps) {
  const functions = useFunctions()

  // Listen for billRef on checkout doc
  const { data: checkout } = useDocument<CheckoutDoc>(`checkouts/${checkoutId}`)
  const billId = checkout?.billRef?.id ?? null

  // Listen for payment status on bill doc
  const { data: bill } = useDocument<BillDoc>(billId ? `bills/${billId}` : null)
  const isPaid = bill?.paidAt != null

  // Fetch QR payload from server once bill exists
  const [qrPayload, setQrPayload] = useState<string | null>(null)
  const [qrError, setQrError] = useState(false)

  useEffect(() => {
    if (!billId) return

    const getQrData = httpsCallable<{ billId: string }, { qrPayload: string }>(
      functions,
      "getPaymentQrData",
    )

    getQrData({ billId })
      .then((result) => setQrPayload(result.data.qrPayload))
      .catch(() => setQrError(true))
  }, [billId, functions])

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <CheckCircle className={`h-14 w-14 mx-auto ${isPaid ? "text-green-600" : "text-cog-teal"}`} />
        <h2 className="text-xl font-bold font-body">
          {isPaid ? "Bezahlt – Vielen Dank!" : "Vielen Dank!"}
        </h2>
      </div>

      {isPaid ? (
        <div className="bg-green-50 rounded-none p-[25px] text-center">
          <p className="text-green-800 font-semibold">
            Zahlung von {formatCHF(totalPrice)} erhalten.
          </p>
          <p className="text-sm text-green-700 mt-2">
            Eine Bestätigung wird dir per Mail zugeschickt.
          </p>
        </div>
      ) : (
        <div className="bg-[rgba(204,204,204,0.2)] rounded-none p-[25px] space-y-4">
          <h3 className="text-xl font-bold font-body text-center underline decoration-cog-teal decoration-2 underline-offset-4">
            Zu bezahlen: {formatCHF(totalPrice)}
          </h3>
          <p className="text-sm text-muted-foreground text-center">
            Bitte bezahle nun den Betrag mit Twint oder deiner E-Banking App.
          </p>

          <div className="flex justify-center pt-2">
            {qrPayload ? (
              <div className="bg-white p-3 rounded inline-block">
                <QRCodeSVG value={qrPayload} size={200} />
              </div>
            ) : qrError ? (
              <p className="text-sm text-destructive text-center">
                QR-Code konnte nicht geladen werden.
              </p>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                QR-Code wird geladen...
              </div>
            )}
          </div>
        </div>
      )}

      {!isPaid && (
        <p className="text-sm text-muted-foreground text-center">
          Eine Zusammenfassung wird dir per Mail geschickt.
        </p>
      )}

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
