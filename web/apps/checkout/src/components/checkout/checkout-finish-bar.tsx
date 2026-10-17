// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The bottom bar once the checkout closed (issue #750), per device:
 *  - kiosk: "Fertig" fills over 8 s, then hands the terminal to the next
 *    person (KIO-8). While held (the QR slip was unfolded — someone is
 *    scanning it; a TWINT payment still runs in the overlay) "Fertig"
 *    waits for a tap instead;
 *  - own device, signed in: "Fertig" without a countdown, to "Meine Besuche";
 *  - own device without an account: nothing to go to, just a line saying
 *    the window can be closed.
 */

import { AutoActionButton } from "./auto-action-button"

// 8 s: the person already paid and is leaving — the terminal should free
// itself quickly for the next visitor.
export const KIOSK_FINISH_MS = 8_000

interface CheckoutFinishBarProps {
  kiosk: boolean
  signedIn: boolean
  /** The kiosk waits for a tap instead of counting down. */
  holdCountdown: boolean
  onFinish: () => void
}

export function CheckoutFinishBar({
  kiosk,
  signedIn,
  holdCountdown,
  onFinish,
}: CheckoutFinishBarProps) {
  return (
    <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background border-t border-border flex gap-3 justify-end items-center min-h-[57px]">
      {kiosk ? (
        holdCountdown ? (
          <FinishButton onClick={onFinish} />
        ) : (
          <AutoActionButton standalone durationMs={KIOSK_FINISH_MS} onAction={onFinish}>
            Fertig
          </AutoActionButton>
        )
      ) : signedIn ? (
        <FinishButton onClick={onFinish} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Du kannst dieses Fenster jetzt schliessen.
        </p>
      )}
    </div>
  )
}

function FinishButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors"
    >
      Fertig
    </button>
  )
}
