// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `catalogCall` — grouped callable for the catalog / price-list domain (#277).
 * Routes upsertCatalogItem / getPriceListPdfUrl.
 */

import { onCall } from "firebase-functions/v2/https";
import { dispatchRpc, type RpcHandler } from "../rpc/dispatch";
import { upsertCatalogItemHandler } from "./upsert_catalog_item";
import { getPriceListPdfUrlHandler } from "../price_list/get_price_list_pdf_url";

const HANDLERS: Record<string, RpcHandler> = {
  upsertCatalogItem: upsertCatalogItemHandler,
  getPriceListPdfUrl: getPriceListPdfUrlHandler,
};

export const catalogCall = onCall({ memory: "512MiB" }, (request) =>
  dispatchRpc("catalog", HANDLERS, request)
);
