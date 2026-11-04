// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The payment part of the Check Out page (issues #750, #833). Step 3 has
 * one button per payment slot in its footer; choosing one turns the page
 * into step 4 in place: the total becomes the grey "Zu bezahlen" strip of
 * one frame, and the chosen method's instruction and commit button sit
 * below it. Nothing is committed until that button — the checkout stays
 * open and "Zurück" returns to an editable step 3.
 */

import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { cn } from "@modules/lib/utils"
import { formatCHF } from "@modules/lib/format"
import {
  PAYMENT_CHOICE_UI,
  TWINT_LOGO_URL,
  type ChoiceCopyContext,
  type PaymentChoice,
} from "./payment-methods"
import { TerminalPaymentPanel } from "./terminal-payment-panel"
import type { TerminalPaymentState } from "./use-terminal-payment"

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
      {/* clip, not hidden: clipping doesn't make a scroll container, so
          step 3's sticky total still sticks to the page (#833). */}
      <div className="min-h-0 overflow-clip">{children}</div>
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

interface PaymentFooterButtonsProps {
  choices: PaymentChoice[]
  onChoose: (choice: PaymentChoice) => void
  disabled?: boolean
}

/**
 * Step 3's payment buttons, in the sticky footer so the next step is always
 * in view (#833): one per slot (`paymentSlots`), or "Abschliessen" for a
 * CHF 0 visit. They only lead to step 4; nothing is committed here. All one
 * height, the pay buttons one width; stacked full width on a phone.
 */
export function PaymentFooterButtons({ choices, onChoose, disabled }: PaymentFooterButtonsProps) {
  return (
    <div
      role="group"
      aria-label="Bezahlen"
      className="flex flex-col sm:flex-row gap-2 sm:gap-3 min-w-0 flex-1 sm:flex-none"
    >
      {choices.map((choice) => {
        const ui = PAYMENT_CHOICE_UI[choice]
        // TWINT's styleguide wants its logo on its dark button.
        const twint = choice === "raisenow"
        return (
          <button
            key={choice}
            type="button"
            disabled={disabled}
            onClick={() => onChoose(choice)}
            data-testid={`payment-option-${choice}`}
            className={cn(
              FOOTER_BUTTON,
              "w-full sm:w-[250px] gap-2.5 px-5 text-[15px] font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors",
              twint
                ? "bg-[#262626] hover:bg-[#333333] active:bg-[#1a1a1a]"
                : "bg-cog-teal hover:bg-cog-teal-dark",
            )}
          >
            {twint ? (
              <img src={TWINT_LOGO_URL} alt="" className="h-[26px] w-auto shrink-0" />
            ) : (
              choice !== "free" && <span className="shrink-0 [&_svg]:h-5 [&_svg]:w-5">{ui.icon}</span>
            )}
            <span className="truncate">{ui.actionLabel}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Every footer button's box (#833): one height, so the bar reads as one row. */
export const FOOTER_BUTTON =
  "inline-flex items-center justify-center h-12 sm:h-[52px] rounded-[4px]"

/**
 * Step 4 and the confirmation: the grey header strip with the amount, the
 * chosen method's body below it in the same frame ("style B"). Neutral frame,
 * no teal: teal marks what is still to choose.
 */
export function PaymentFrame({
  amount,
  free,
  footer,
  children,
}: {
  amount: number
  free: boolean
  /** A row below the content, right-aligned (the confirmation's PDF). */
  footer?: ReactNode
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
      {footer && (
        <div className="flex justify-end border-t border-border px-5 sm:px-6 py-3">
          {footer}
        </div>
      )}
    </div>
  )
}

interface PaymentStepProps {
  choice: PaymentChoice
  copy: ChoiceCopyContext
  committing: boolean
  onCommit: () => void
  /** The terminal payment, for "Karte / TWINT" (armed on choosing it). */
  terminal?: TerminalPaymentState | null
  onTerminalRetry?: () => void
}

/**
 * Step 4's body: the chosen method with its instruction and commit button —
 * or, for the payment terminal, the terminal's status: choosing it
 * already armed it, there is nothing to commit here (ADR-0051).
 */
export function PaymentStep({
  choice,
  copy,
  committing,
  onCommit,
  terminal,
  onTerminalRetry,
}: PaymentStepProps) {
  const ui = PAYMENT_CHOICE_UI[choice]
  const terminalChoice = choice === "wallee_terminal"
  // The instruction only helps while the terminal still wants something.
  const instruction =
    terminalChoice &&
    terminal &&
    !["preparing", "waiting", "processing"].includes(terminal.phase)
      ? null
      : ui.instruction(copy)
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
        {terminalChoice ? (
          terminal && <TerminalPaymentPanel terminal={terminal} onRetry={() => onTerminalRetry?.()} />
        ) : choice === "raisenow" ? (
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
