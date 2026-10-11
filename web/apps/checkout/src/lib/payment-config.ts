// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  parsePaymentMethodList,
  type PaymentMethod,
  type PaymentMethodConfig,
} from "@oww/shared"

/**
 * Payment methods per client type, baked in at build time from the
 * operations config (`web.paymentMethodsKiosk` / `web.paymentMethodsWeb`
 * → `VITE_PAYMENT_METHODS_*`). The functions read the same keys, so the
 * server accepts what the UI offers. `generate-env` rejects unknown ids, so
 * the fallback below only guards a hand-edited env file: offering just the
 * QR bill is always safe, whereas the defaults could re-enable a retired
 * integration.
 */
function parseOrQrBillOnly(name: string, csv: string | undefined): PaymentMethod[] {
  try {
    return parsePaymentMethodList(csv)
  } catch (err) {
    console.error(`${name}: ${String(err)} — offering only the QR bill`)
    return ["rechnung"]
  }
}

export const paymentMethodConfig: PaymentMethodConfig = {
  kiosk: parseOrQrBillOnly(
    "VITE_PAYMENT_METHODS_KIOSK",
    import.meta.env.VITE_PAYMENT_METHODS_KIOSK,
  ),
  web: parseOrQrBillOnly(
    "VITE_PAYMENT_METHODS_WEB",
    import.meta.env.VITE_PAYMENT_METHODS_WEB,
  ),
}
