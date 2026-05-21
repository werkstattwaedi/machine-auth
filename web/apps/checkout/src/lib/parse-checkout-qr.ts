// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Discriminated intent emitted by the QR scanner. The host hook
 * (`useScanNavigation`) maps each variant to a TanStack Router deep
 * link under `/visit/add/...`.
 */
export type RouteIntent =
  | { kind: "list"; listId: string }
  | { kind: "item"; code: string }
  | { kind: "itemVariant"; code: string; variantId: string }
  | { kind: "workshop"; workshopId: string }

/**
 * Parse a string captured by the QR decoder into a routable intent.
 *
 * Accepts either a full URL (the printed price-list QR encodes
 * `https://{CHECKOUT_DOMAIN}/visit/add/list/{id}`) or a bare path. The
 * host portion is intentionally ignored so a QR printed against the
 * prod domain still routes locally in dev/preview environments — what
 * matters is the path shape.
 *
 * Returns `null` for anything outside the `/visit/add/*` allow-list;
 * the scanner UI surfaces that as an invalid-QR toast.
 */
export function parseCheckoutQr(raw: string): RouteIntent | null {
  if (!raw) return null
  const path = extractPath(raw.trim())
  if (!path) return null

  const segments = path.split("/").filter((s) => s.length > 0)
  // Expect: ["visit", "add", <kind>, <id>, ...]
  if (segments.length < 4 || segments[0] !== "visit" || segments[1] !== "add") {
    return null
  }

  const [, , kind, a, b] = segments
  switch (kind) {
    case "list":
      if (segments.length !== 4 || !a) return null
      return { kind: "list", listId: a }
    case "workshop":
      if (segments.length !== 4 || !a) return null
      return { kind: "workshop", workshopId: a }
    case "item":
      if (segments.length === 4 && a) return { kind: "item", code: a }
      if (segments.length === 5 && a && b)
        return { kind: "itemVariant", code: a, variantId: b }
      return null
    default:
      return null
  }
}

function extractPath(raw: string): string | null {
  // Try full URL first.
  try {
    const url = new URL(raw)
    return url.pathname
  } catch {
    // Not a URL — fall through to path-style strings.
  }
  if (raw.startsWith("/")) return raw.split("?")[0].split("#")[0]
  return null
}
