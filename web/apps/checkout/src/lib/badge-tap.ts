// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * A badge tap opened outside the kiosk (#602): the tag link on a phone.
 * Only the kiosk can turn a tap into a session — the mint is bearer-gated
 * (ADR-0022) — so the tap is never sent to the server from here; the
 * person goes to the sign-in page, which says why they landed there.
 */
export function isOwnDeviceTap(search: {
  picc?: string
  cmac?: string
  kiosk?: string
}): boolean {
  return !!search.picc && !!search.cmac && search.kiosk === undefined
}

/**
 * Where to send an own-device tap. The tag link opens on its own host (the
 * `id.` alias), where sign-in is refused (login codes are bound to the
 * allowed origins), so a full-page move to the checkout domain is needed;
 * already there, `null` — the caller navigates within the app.
 */
export function ownDeviceTapLoginUrl(
  location: { host: string; protocol: string },
  checkoutDomain: string,
): string | null {
  if (location.host === checkoutDomain) return null
  return `${location.protocol}//${checkoutDomain}/login?from=badge`
}
