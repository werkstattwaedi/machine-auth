// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createHash } from "node:crypto";
import { formatInTimeZone } from "date-fns-tz";
import {
  assertCheckoutDomainConfigured,
  resolveCheckoutDomain,
} from "../util/checkout-domain";
import { downloadUrlFor, pdfSaveOptions } from "../util/storage_download";
import type { PriceListRenderData } from "./types";
import {
  PriceListDeriveError,
  derivePriceListRenderData,
  type PriceListSourceItem,
} from "./derive_render_data";

// Re-exported so the existing regression test (get_price_list_pdf_url.test.ts)
// keeps importing it from here. The implementation now lives in the shared
// `util/checkout-domain` helper (it has two call sites: this PDF path and the
// stale-checkout /denied deep link — issue #535).
export { assertCheckoutDomainConfigured };

/**
 * Build the public deep link encoded in the price-list QR code.
 *
 * Pure string builder — exported so unit tests can verify the canonical
 * shape without spinning up the Functions runtime / stubbing
 * `defineString`.
 */
export function buildPriceListQrUrl(
  domain: string,
  priceListId: string,
): string {
  return `https://${domain}/visit/add/list/${priceListId}`;
}

// Only the fields this handler reads; the printed title/filename come from
// the derived render data (common-prefix rule), not the doc's admin name.
interface PriceListDoc {
  items?: string[];
  active?: boolean;
}

/**
 * Build the SHA-256 hash that uniquely identifies the rendered output.
 * The render data contains everything that affects the PDF bytes — title,
 * color, stand date, QR URL, and every category/row — so any meaningful
 * change produces a different storage object (and an unchanged re-click
 * reuses the cached one).
 */
export function buildPriceListContentHash(data: PriceListRenderData): string {
  return createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Fetch catalog items by id. Items that have been deleted are silently
 * skipped.
 */
async function loadCatalogItems(
  itemIds: string[],
): Promise<Map<string, PriceListSourceItem>> {
  const result = new Map<string, PriceListSourceItem>();
  if (itemIds.length === 0) return result;

  const db = getFirestore();
  // getAll accepts up to 100 refs at once and avoids the `in` query limit.
  const refs = itemIds.map((id) => db.doc(`catalog/${id}`));
  const docs = await db.getAll(...refs);
  for (const doc of docs) {
    if (!doc.exists) continue;
    result.set(doc.id, doc.data() as PriceListSourceItem);
  }
  return result;
}

export const getPriceListPdfUrlHandler = async (
  request: CallableRequest<unknown>,
) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }
  if (request.auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "Admin role required");
  }

  const { priceListId } = (request.data ?? {}) as { priceListId?: unknown };
  if (typeof priceListId !== "string" || !priceListId) {
    throw new HttpsError("invalid-argument", "priceListId is required");
  }

  const db = getFirestore();
  const snap = await db.doc(`price_lists/${priceListId}`).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Price list not found");
  }
  const priceList = snap.data() as PriceListDoc;

  const itemIds = (priceList.items ?? []).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  const catalog = await loadCatalogItems(itemIds);

  const qrUrl = buildPriceListQrUrl(resolveCheckoutDomain(), priceListId);
  // The "Stand" footer date is the generation date, in the workshop's
  // timezone (the PDF hangs on a wall in Wädenswil, not in UTC).
  const stand = formatInTimeZone(new Date(), "Europe/Zurich", "dd.MM.yyyy");

  let renderData: PriceListRenderData;
  try {
    renderData = derivePriceListRenderData(
      itemIds
        .map((id) => catalog.get(id))
        .filter((doc): doc is PriceListSourceItem => doc != null),
      { qrUrl, stand },
    );
  } catch (err) {
    if (err instanceof PriceListDeriveError) {
      throw new HttpsError("failed-precondition", err.message);
    }
    throw err;
  }

  // Lazy import: pdfkit + qrcode (~7 MB) shouldn't be paid by every
  // other function's cold start. Only this admin-only path needs them.
  const { buildPriceListPdf, priceListFilename } =
    await import("./build_price_list_pdf.js");

  const hash = buildPriceListContentHash(renderData);
  const storagePath = `price-lists/${priceListId}/${hash}.pdf`;
  const filename = priceListFilename(renderData.title);

  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);

  // Cache by content hash: skip regeneration if the same render already lives
  // at this path. Falls through on any error (including "object not found")
  // since the regeneration cost is small.
  let exists = false;
  try {
    [exists] = await file.exists();
  } catch {
    exists = false;
  }

  if (!exists) {
    const pdfBuffer = await buildPriceListPdf(renderData);
    await file.save(pdfBuffer, pdfSaveOptions());
    logger.info(
      `Generated price-list PDF ${storagePath} (${pdfBuffer.length} bytes)`,
    );
  } else {
    logger.info(`Reusing cached price-list PDF ${storagePath}`);
  }

  const url = await downloadUrlFor(file, {
    action: "read",
    expires: Date.now() + 3600 * 1000,
    responseDisposition: `attachment; filename="${filename}"`,
  });

  return { url };
};
