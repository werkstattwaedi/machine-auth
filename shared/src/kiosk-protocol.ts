// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Custom URL scheme the checkout kiosk registers with Windows. Launching any
// `oww-kiosk://…` URL starts the kiosk, or — when it already runs — is relayed
// to the running instance as `second-instance`, which surfaces its window.
//
// The web checkout uses it on the shared terminal PC: a browser there that has
// been marked as "the kiosk PC" refuses to run the web checkout and hands the
// visitor over to the kiosk app instead (web/apps/checkout, kiosk-pc-gate).
export const KIOSK_PROTOCOL = "oww-kiosk"

/** URL that opens (or surfaces) the kiosk app. The path carries no meaning. */
export const KIOSK_LAUNCH_URL = `${KIOSK_PROTOCOL}://open`
