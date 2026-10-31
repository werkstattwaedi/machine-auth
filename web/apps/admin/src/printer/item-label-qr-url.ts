// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Build the public checkout deep link encoded in an item label QR code.
 *
 * The URL MUST include the `https://` scheme: the checkout QR parser
 * (`parse-checkout-qr.ts`) only accepts fully-schemed URLs (or bare
 * paths), so a scheme-less host like `checkout.werkstattwaedi.ch/...`
 * is rejected as "not a OWW qr code" (issue #375). This mirrors the
 * price-list QR builder (`buildPriceListQrUrl`), which also prepends
 * `https://`.
 *
 * `domain` is the bare host (e.g. `checkout.werkstattwaedi.ch`) sourced
 * from `VITE_CHECKOUT_DOMAIN`. With a `variantId`, the checkout's picker
 * opens with that variant preselected.
 */
export function buildItemLabelQrUrl(
  domain: string,
  code: string,
  variantId?: string,
): string {
  const url = `https://${domain}/visit/add/item/${code}`
  return variantId ? `${url}/${encodeURIComponent(variantId)}` : url
}
