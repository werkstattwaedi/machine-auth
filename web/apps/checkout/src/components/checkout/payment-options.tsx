// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The payment part of the Check Out page (issue #750). Step 3 lists one
 * action card per method under the total; choosing one turns the page into
 * step 4 in place: the total becomes the grey "Zu bezahlen" strip of one
 * frame, and the chosen card's instruction and commit button sit below it.
 * Nothing is committed until that button — the checkout stays open and
 * "Zurück" returns to an editable step 3.
 */

import type { ReactNode } from "react"
import { ChevronRight, Loader2 } from "lucide-react"
import { cn } from "@modules/lib/utils"
import { formatCHF } from "@modules/lib/format"
import {
  PAYMENT_CHOICE_UI,
  TWINT_LOGO_URL,
  type ChoiceCopyContext,
  type PaymentChoice,
} from "./payment-methods"

/**
 * Folds its children away (height to zero, faded) and back. CSS grid rows
 * animate between `0fr` and `1fr` without measuring; reduced motion makes
 * it instant. A folded block is inert, so nothing in it takes focus.
 */
export function Fold({
  open,
  children,
  className,
}: {
  open: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-[420ms] ease-in-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

export function ChoiceIcon({ choice }: { choice: PaymentChoice }) {
  const ui = PAYMENT_CHOICE_UI[choice]
  return (
    <span
      className={cn(
        "shrink-0 flex h-9 w-9 items-center justify-center rounded-md",
        // TWINT styleguide mandates its logo on a dark surface — keep it as
        // a brand chip. Our own methods sit on a neutral gray.
        ui.darkIconChip ? "bg-[#262626] text-white" : "bg-muted text-foreground/80",
      )}
    >
      {ui.icon}
    </span>
  )
}

interface PaymentOptionCardsProps {
  choices: PaymentChoice[]
  onChoose: (choice: PaymentChoice) => void
  disabled?: boolean
}

/** Step 3: "Wie möchtest du bezahlen?" and one action card per choice. */
export function PaymentOptionCards({ choices, onChoose, disabled }: PaymentOptionCardsProps) {
  const free = choices.length === 1 && choices[0] === "free"
  return (
    <section aria-labelledby="payment-options-heading" className="flex flex-col gap-3">
      <h2
        id="payment-options-heading"
        className="font-heading font-bold text-lg text-foreground"
      >
        {free ? "Nichts zu bezahlen" : "Wie möchtest du bezahlen?"}
      </h2>
      <div className="flex flex-col gap-2">
        {choices.map((choice) => {
          const ui = PAYMENT_CHOICE_UI[choice]
          return (
            <button
              key={choice}
              type="button"
              disabled={disabled}
              onClick={() => onChoose(choice)}
              data-testid={`payment-option-${choice}`}
              className="group w-full flex items-center gap-4 text-left rounded-lg border border-border bg-white px-4 sm:px-5 py-3.5 transition-colors hover:border-cog-teal/60 hover:bg-cog-teal-light disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChoiceIcon choice={choice} />
              <span className="min-w-0 flex-1">
                <span className="block font-heading font-semibold text-[15px] leading-tight text-foreground">
                  {ui.title}
                </span>
                <span className="block mt-0.5 text-sm text-muted-foreground leading-snug">
                  {ui.description}
                </span>
              </span>
              <span className="shrink-0 hidden sm:inline-flex items-center gap-1 text-sm font-bold text-cog-teal">
                {ui.actionLabel}
                <ChevronRight className="h-4 w-4" />
              </span>
              <ChevronRight className="sm:hidden h-5 w-5 shrink-0 text-cog-teal" aria-hidden />
            </button>
          )
        })}
      </div>
    </section>
  )
}

/**
 * Step 4 and the confirmation: the grey header strip with the amount, the
 * chosen card's body below it in the same frame ("style B"). Neutral frame,
 * no teal: teal marks what is still to choose.
 */
export function PaymentFrame({
  amount,
  free,
  children,
}: {
  amount: number
  free: boolean
  children: ReactNode
}) {
  return (
    <div
      data-testid="payment-frame"
      className="rounded-lg border border-border bg-white overflow-hidden"
    >
      <div className="flex items-baseline justify-between gap-4 bg-muted/60 px-5 sm:px-6 py-4 border-b border-border">
        <span className="font-heading font-bold text-lg">
          {free ? "Total" : "Zu bezahlen"}
        </span>
        <div className="text-right">
          <span className="font-heading font-bold text-2xl tabular-nums">
            {formatCHF(amount)}
          </span>
          <span className="block text-xs text-muted-foreground">keine MWST.</span>
        </div>
      </div>
      <div className="px-5 sm:px-6 py-5 sm:py-6">{children}</div>
    </div>
  )
}

interface PaymentStepProps {
  choice: PaymentChoice
  copy: ChoiceCopyContext
  committing: boolean
  onCommit: () => void
}

/** Step 4's body: the chosen card with its instruction and commit button. */
export function PaymentStep({ choice, copy, committing, onCommit }: PaymentStepProps) {
  const ui = PAYMENT_CHOICE_UI[choice]
  const instruction = ui.instruction(copy)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <ChoiceIcon choice={choice} />
        <span className="font-heading font-semibold text-[17px] leading-tight">
          {ui.title}
        </span>
      </div>
      {instruction && (
        <p className="text-sm text-foreground leading-relaxed max-w-2xl">{instruction}</p>
      )}
      <div>
        {choice === "raisenow" ? (
          <TwintButton onClick={onCommit} busy={committing} />
        ) : (
          <button
            type="button"
            onClick={onCommit}
            disabled={committing}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {committing && <Loader2 className="h-4 w-4 animate-spin" />}
            {ui.commitLabel}
          </button>
        )}
      </div>
    </div>
  )
}

/** TWINT's own button (styleguide: dark, logo left, fixed size). */
function TwintButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center justify-center w-[270px] max-w-full h-[56px] px-[35px] bg-[#262626] rounded-[6px] hover:bg-[#333333] active:bg-[#1a1a1a] transition-colors disabled:opacity-70"
    >
      {busy ? (
        <Loader2 className="h-6 w-6 mr-[20px] shrink-0 animate-spin text-white" />
      ) : (
        <img src={TWINT_LOGO_URL} alt="" className="h-[36px] w-[32px] mr-[20px] shrink-0" />
      )}
      <span className="text-[17px] font-medium text-white whitespace-nowrap">
        Mit TWINT bezahlen
      </span>
    </button>
  )
}
