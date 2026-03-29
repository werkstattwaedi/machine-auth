// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState } from "react"
import { useAuth } from "@modules/lib/auth"
import { Button } from "@modules/components/ui/button"
import { Input } from "@modules/components/ui/input"
import { Loader2, Mail, ArrowRight } from "lucide-react"
import { toast } from "sonner"

interface CheckoutLandingProps {
  kiosk: boolean
  onAnonymous: () => void
}

export function CheckoutLanding({ kiosk, onAnonymous }: CheckoutLandingProps) {
  if (kiosk) {
    return <KioskLanding onAnonymous={onAnonymous} />
  }
  return <BrowserLanding onAnonymous={onAnonymous} />
}

function KioskLanding({ onAnonymous }: { onAnonymous: () => void }) {
  return (
    <div className="flex flex-col items-center gap-10 py-12">
      {/* NFC tap animation */}
      <div className="relative flex items-center justify-center w-40 h-40">
        {/* Pulsing rings */}
        <div className="absolute inset-0 rounded-full border-2 border-cog-teal/30 animate-[ping_2s_ease-out_infinite]" />
        <div className="absolute inset-3 rounded-full border-2 border-cog-teal/40 animate-[ping_2s_ease-out_0.4s_infinite]" />
        <div className="absolute inset-6 rounded-full border-2 border-cog-teal/50 animate-[ping_2s_ease-out_0.8s_infinite]" />
        {/* NFC icon (card/badge shape) */}
        <svg
          viewBox="0 0 64 64"
          className="relative w-20 h-20 text-cog-teal"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Card outline */}
          <rect x="10" y="14" width="44" height="36" rx="4" />
          {/* NFC waves */}
          <path d="M30 38a4 4 0 0 1 0-8" />
          <path d="M26 42a10 10 0 0 1 0-20" />
          <path d="M22 46a16 16 0 0 1 0-28" />
        </svg>
      </div>

      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">
          Badge an den Leser halten
        </h2>
        <p className="text-muted-foreground">
          Halte deinen Werkstatt-Badge an den NFC-Leser, um den Checkout zu starten.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 pt-2">
        <span className="text-sm text-muted-foreground">oder</span>
        <Button
          variant="outline"
          onClick={onAnonymous}
          className="font-semibold"
        >
          Ohne Badge fortfahren
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  )
}

function BrowserLanding({ onAnonymous }: { onAnonymous: () => void }) {
  const { signInWithEmail } = useAuth()
  const [email, setEmail] = useState("")
  const [sending, setSending] = useState(false)
  const [linkSent, setLinkSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setSending(true)
    try {
      await signInWithEmail(email)
      setLinkSent(true)
      toast.success("Anmelde-Link gesendet!")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Fehler"
      toast.error(`Fehler: ${message}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-8 py-12">
      <div className="w-full max-w-sm border border-border rounded p-6 space-y-4">
        <h2 className="text-lg font-bold text-center">Anmelden</h2>
        <p className="text-sm text-muted-foreground text-center">
          Melde dich mit deiner E-Mail an, um deinen Checkout zu starten.
        </p>
        {linkSent ? (
          <div className="text-center space-y-3">
            <Mail className="h-10 w-10 mx-auto text-cog-teal" />
            <p className="text-sm">
              Anmelde-Link wurde an <strong>{email}</strong> gesendet.
            </p>
            <p className="text-sm text-muted-foreground">
              Pruefe dein Postfach und klicke auf den Link.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="email"
              placeholder="deine@email.ch"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Button
              type="submit"
              className="w-full bg-cog-teal hover:bg-cog-teal-dark text-white font-semibold"
              disabled={sending}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Anmelde-Link senden
            </Button>
          </form>
        )}
      </div>

      <div className="flex flex-col items-center gap-3">
        <span className="text-sm text-muted-foreground">oder</span>
        <Button
          variant="outline"
          onClick={onAnonymous}
          className="font-semibold"
        >
          Ohne Anmeldung fortfahren
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  )
}
