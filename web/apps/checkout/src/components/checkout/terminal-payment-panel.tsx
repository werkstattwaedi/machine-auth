// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Step 4's body for "Karte / TWINT" (ADR-0051, #750 mockup): what the
 * terminal next to the screen is doing, and the way out when it didn't
 * work. No instruction sentences — a status line, plus an amber box only
 * where the person has to decide something.
 */

import { CircleX, Loader2 } from "lucide-react"
import type { TerminalPaymentState } from "./use-terminal-payment"

interface TerminalPaymentPanelProps {
  terminal: TerminalPaymentState
  onRetry: () => void
}

export function TerminalPaymentPanel({ terminal, onRetry }: TerminalPaymentPanelProps) {
  const retry = (
    <div>
      <button
        type="button"
        onClick={onRetry}
        data-testid="terminal-retry"
        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors"
      >
        Nochmals versuchen
      </button>
    </div>
  )

  switch (terminal.phase) {
    case "preparing":
    case "waiting":
      return (
        <Status testId="terminal-waiting" icon={<WaitDot />}>
          Terminal wartet auf deine Karte
        </Status>
      )
    case "processing":
      return (
        <Status testId="terminal-processing" icon={<Spinner />}>
          Zahlung läuft
        </Status>
      )
    case "checking":
      return (
        <Status testId="terminal-checking" icon={<Spinner />}>
          Zahlung wird geprüft
        </Status>
      )
    case "declined":
      return (
        <div className="flex flex-col gap-4">
          <Status testId="terminal-declined" icon={<Cross />}>
            Bezahlung abgelehnt
          </Status>
          {retry}
        </div>
      )
    case "timeout":
      return (
        <div className="flex flex-col gap-4">
          <Status testId="terminal-timeout" icon={<Cross />}>
            Keine Karte erkannt
          </Status>
          {retry}
        </div>
      )
    case "error":
      return (
        <div className="flex flex-col gap-4">
          <Status testId="terminal-error" icon={<Cross />}>
            Zahlung nicht möglich
          </Status>
          {terminal.errorText && <AmberBox>{terminal.errorText}</AmberBox>}
          {retry}
        </div>
      )
    case "unknown":
      // The connection dropped and no payment reached Wallee while we
      // watched. One may still be on its way: paying again risks a double
      // charge, so say what to look at first.
      return (
        <div className="flex flex-col gap-4">
          <Status testId="terminal-unknown">Keine Zahlung angekommen</Status>
          <AmberBox>
            Zeigt das Terminal «bezahlt»? Dann melde dich beim Team, statt nochmals
            zu bezahlen.
          </AmberBox>
          {retry}
        </div>
      )
    case "approved":
      return null
  }
}

function Status({
  icon,
  testId,
  children,
}: {
  icon?: React.ReactNode
  testId: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3" role="status" data-testid={testId}>
      {icon}
      <span className="font-heading font-bold text-xl text-foreground">{children}</span>
    </div>
  )
}

function AmberBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-2xl rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 leading-relaxed">
      {children}
    </div>
  )
}

function WaitDot() {
  return (
    <span className="relative flex h-3 w-3 shrink-0" aria-hidden>
      <span className="absolute inline-flex h-full w-full rounded-full bg-cog-teal opacity-60 animate-ping motion-reduce:animate-none" />
      <span className="relative inline-flex h-3 w-3 rounded-full bg-cog-teal" />
    </span>
  )
}

function Spinner() {
  return <Loader2 className="h-6 w-6 shrink-0 animate-spin text-cog-teal-dark" aria-hidden />
}

function Cross() {
  return <CircleX className="h-7 w-7 shrink-0 text-red-600" strokeWidth={1.8} aria-hidden />
}
