// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
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
    <div className="space-y-4">
      <div className="text-center space-y-2">
        <CheckCircle className="h-12 w-12 text-green-600 mx-auto" />
        <h2 className="text-lg font-semibold">Vielen Dank!</h2>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-center">
            Zu bezahlen: {formatCHF(totalPrice)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Bitte bezahle nun den Betrag mit Twint oder deiner E-Banking App.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="text-center space-y-2">
              <h3 className="text-sm font-medium">E-Banking</h3>
              <div className="bg-white p-3 rounded-md inline-block mx-auto">
                <QRCodeSVG
                  value={`SPC\n0200\n1\nCH5606814580126005097\nS\nVerein Offene Werkstatt Wädenswil\n\n\n\n8820\nWädenswil\nCH\n\n\n\n\n\n\n\n${totalPrice.toFixed(2)}\nCHF\n\n\n\n\n\n\n\nNON\n\n\nEPD`}
                  size={160}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                IBAN: {IBAN}
              </p>
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-sm font-medium">Twint</h3>
              <div className="bg-white p-3 rounded-md inline-block mx-auto">
                <QRCodeSVG value={TWINT_QR_DATA} size={160} />
              </div>
              <p className="text-xs text-muted-foreground">
                Twint QR-Code scannen
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground text-center">
        Eine Zusammenfassung haben wir dir per Mail geschickt.
      </p>

      <Button variant="outline" className="w-full" onClick={onReset}>
        Zurück zum Start
      </Button>
    </div>
  )
}
