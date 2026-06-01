// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `billingCall` — grouped callable for the invoice/checkout/payment domain
 * (#277). Routes getInvoiceDownloadUrl / getPaymentQrData /
 * closeCheckoutAndGetPayment / acknowledgeBill.
 */

import { onCall } from "firebase-functions/v2/https";
import { dispatchRpc, type RpcHandler } from "../rpc/dispatch";
import { getInvoiceDownloadUrlHandler } from "./get_invoice_download_url";
import { getPaymentQrDataHandler } from "./get_payment_qr_data";
import { closeCheckoutAndGetPaymentHandler } from "./close_checkout_and_get_payment";
import { acknowledgeBillHandler } from "./acknowledge_bill";

const HANDLERS: Record<string, RpcHandler> = {
  getInvoiceDownloadUrl: getInvoiceDownloadUrlHandler,
  getPaymentQrData: getPaymentQrDataHandler,
  closeCheckoutAndGetPayment: closeCheckoutAndGetPaymentHandler,
  acknowledgeBill: acknowledgeBillHandler,
};

export const billingCall = onCall({ memory: "512MiB" }, (request) =>
  dispatchRpc("billing", HANDLERS, request)
);
