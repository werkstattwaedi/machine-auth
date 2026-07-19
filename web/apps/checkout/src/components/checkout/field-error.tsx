// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The checkout wizard's standard inline field-error visual: a hardcoded red
 * (#cc2a24) badge under the field plus a matching red input border. Originally
 * inlined in person-card.tsx (Check-In person fields); extracted here so every
 * wizard field — person cards, pinned machine hours, material picker — renders
 * the same error affordance.
 *
 * (This is deliberately the wizard's own #cc2a24 style, not the shadcn
 * `text-destructive` token; it keeps error UI consistent within the checkout.)
 */

// 16px on mobile: iOS Safari auto-zooms when a focused control's font-size is
// below 16px (issue #492) — keep text-base until md.
const FIELD_INPUT_BASE =
  "flex h-9 w-full rounded-none border bg-background px-3 py-1 text-base md:text-sm outline-none"

/** Neutral field border (grey, teal on focus). */
export const FIELD_INPUT_OK = `${FIELD_INPUT_BASE} border-[#ccc] focus:border-cog-teal`

/** Error field border (red, stays red on focus). */
export const FIELD_INPUT_ERR = `${FIELD_INPUT_BASE} border-[#cc2a24] focus:border-[#cc2a24]`

/** The red error border/focus classes on their own, to compose onto inputs
 *  that don't use the standard h-9 field base (e.g. the compact pinned-hours
 *  input). */
export const FIELD_ERR_BORDER = "border-[#cc2a24] focus:border-[#cc2a24]"

export function ErrorBadge({ message }: { message: string }) {
  return (
    <span
      role="alert"
      className="mt-1 block w-full rounded-sm bg-[#cc2a24] px-2 py-0.5 text-xs text-white"
    >
      {message}
    </span>
  )
}
