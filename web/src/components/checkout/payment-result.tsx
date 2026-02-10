// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { formatCHF } from "@/lib/format"
import { CheckCircle } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"

// Swiss QR-bill payment details
const IBAN = "CH56 0681 4580 1260 0509 7"
const TWINT_QR_DATA = "https://pay.twint.ch/1/merchant/oww"

interface PaymentResultProps {
  totalPrice: number
  onReset: () => void
}

export function PaymentResult({ totalPrice, onReset }: PaymentResultProps) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <CheckCircle className="h-14 w-14 text-cog-teal mx-auto" />
        <h2 className="text-xl font-bold font-body">
          Vielen Dank!
        </h2>
      </div>

      <div className="bg-[rgba(204,204,204,0.2)] rounded-none p-[25px] space-y-4">
        <h3 className="text-xl font-bold font-body text-center underline decoration-cog-teal decoration-2 underline-offset-4"
           >
          Zu bezahlen: {formatCHF(totalPrice)}
        </h3>
        <p className="text-sm text-muted-foreground text-center">
          Bitte bezahle nun den Betrag mit Twint oder deiner E-Banking App.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
          <div className="text-center space-y-3">
            <h4 className="font-semibold">E-Banking</h4>
            <div className="bg-white p-3 rounded inline-block mx-auto">
              <QRCodeSVG
                value={`SPC\n0200\n1\nCH5606814580126005097\nS\nVerein Offene Werkstatt Wädenswil\n\n\n\n8820\nWädenswil\nCH\n\n\n\n\n\n\n\n${totalPrice.toFixed(2)}\nCHF\n\n\n\n\n\n\n\nNON\n\n\nEPD`}
                size={160}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              IBAN: {IBAN}
            </p>
          </div>

          <div className="text-center space-y-3">
            <h4 className="font-semibold">Twint</h4>
            <div className="bg-white p-3 rounded inline-block mx-auto">
              <QRCodeSVG value={TWINT_QR_DATA} size={160} />
            </div>
            <p className="text-xs text-muted-foreground">
              Twint QR-Code scannen
            </p>
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground text-center">
        Eine Zusammenfassung haben wir dir per Mail geschickt.
      </p>

      <button
        type="button"
        className="inline-flex items-center justify-center w-full gap-2 px-3 py-1.5 text-sm font-bold text-cog-teal border border-cog-teal rounded-[3px] bg-white hover:bg-cog-teal-light transition-colors"
        onClick={onReset}
      >
        Zurück zum Start
      </button>
    </div>
  )
}
