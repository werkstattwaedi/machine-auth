// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { defineString } from "firebase-functions/params";
import {
  parsePaymentMethodList,
  isPaymentMethodEnabledAnywhere,
  type PaymentMethod,
  type PaymentMethodConfig,
} from "@oww/shared";

/**
 * Payment methods offered per client type, from the operations config
 * (`web.paymentMethodsKiosk` / `web.paymentMethodsWeb`, wired by
 * `scripts/generate-env.ts`). The web apps read the same keys as
 * `VITE_PAYMENT_METHODS_*`. Empty means "not configured" and yields the
 * defaults from `@oww/shared`, so environments without the keys keep
 * today's behaviour.
 */
const paymentMethodsKiosk = defineString("PAYMENT_METHODS_KIOSK", { default: "" });
const paymentMethodsWeb = defineString("PAYMENT_METHODS_WEB", { default: "" });

export function paymentMethodConfig(): PaymentMethodConfig {
  return {
    kiosk: parsePaymentMethodList(paymentMethodsKiosk.value()),
    web: parsePaymentMethodList(paymentMethodsWeb.value()),
  };
}

/**
 * Server-side gate. Deliberately not per client type: which tab a client
 * shows is a UI decision, and a customer gains nothing by picking a method
 * another client type offers. What the server refuses is a method that is
 * switched off everywhere (e.g. RaiseNow once it is retired).
 */
export function isPaymentMethodEnabled(method: PaymentMethod): boolean {
  return isPaymentMethodEnabledAnywhere(paymentMethodConfig(), method);
}
