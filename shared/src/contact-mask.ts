// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Contact-address masking for screens a not-yet-verified kiosk session sees
 * (ADR-0041): the step-up dialog offers "E-Mail an mi•••@gm•••.com", and an
 * un-elevated badge session shows the owner's address the same way (#668).
 * One implementation so the server's dialog payload and the client's
 * render-time masking always agree.
 */

/** `michschn@gmail.com` → `mi•••@gm•••.com` */
export function maskEmail(email: string): string {
  const at = email.indexOf("@")
  if (at <= 0) return "•••"
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const lastDot = domain.lastIndexOf(".")
  const host = lastDot > 0 ? domain.slice(0, lastDot) : domain
  const tld = lastDot > 0 ? domain.slice(lastDot) : ""
  return `${local.slice(0, 2)}•••@${host.slice(0, 2)}•••${tld}`
}

/** `+41791234528` → `+41 79 ••• •• 28` (last two digits kept). */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/[^\d]/g, "")
  if (digits.length < 6) return "•••"
  const country = e164.startsWith("+") ? `+${digits.slice(0, 2)}` : digits.slice(0, 2)
  const rest = digits.slice(2)
  const prefix = rest.slice(0, 2)
  const tail = rest.slice(-2)
  return `${country} ${prefix} ••• •• ${tail}`
}
