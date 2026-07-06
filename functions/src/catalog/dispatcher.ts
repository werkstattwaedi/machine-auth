// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `catalogCall` — grouped callable for the catalog / price-list domain (#277).
 * Routes upsertCatalogItem / getPriceListPdfUrl / previewCatalogImport /
 * applyCatalogImport.
 */

import { onCall } from "firebase-functions/v2/https";
import { dispatchRpc, type RpcHandler } from "../rpc/dispatch";
import { upsertCatalogItemHandler } from "./upsert_catalog_item";
import { getPriceListPdfUrlHandler } from "../price_list/get_price_list_pdf_url";
import {
  previewCatalogImportHandler,
  applyCatalogImportHandler,
} from "./import_catalog";

const HANDLERS: Record<string, RpcHandler> = {
  upsertCatalogItem: upsertCatalogItemHandler,
  getPriceListPdfUrl: getPriceListPdfUrlHandler,
  previewCatalogImport: previewCatalogImportHandler,
  applyCatalogImport: applyCatalogImportHandler,
};

// 1 GiB + longer timeout: a full-catalog import parses an xlsx in memory and
// may write a few hundred docs in one call.
export const catalogCall = onCall({ memory: "1GiB", timeoutSeconds: 120 }, (request) =>
  dispatchRpc("catalog", HANDLERS, request)
);
