// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createHash } from "node:crypto";
import {
  buildPriceListPdf,
  priceListFilename,
} from "./build_price_list_pdf";
import type {
  PriceListCatalogItem,
  PriceListRenderData,
  PricingModel,
} from "./types";

/**
 * Domain hosting the public checkout app — used to build the QR-code
 * deep link printed on the price list. Falls back to localhost so emulator
 * + test runs work without extra config; production overrides via the
 * `CHECKOUT_DOMAIN` Cloud Functions runtime env.
 */
function checkoutDomain(): string {
  return process.env.CHECKOUT_DOMAIN || "localhost:5173";
}

interface PriceListDoc {
  name: string;
  footer?: string | null;
  items?: string[];
  active?: boolean;
}

interface CatalogItemDoc {
  code: string;
  name: string;
  pricingModel: PricingModel;
  unitPrice?: Record<string, number>;
}

/**
 * Build the SHA-256 hash that uniquely identifies the rendered output.
 * Includes everything that affects the PDF bytes — name, footer, qr URL,
 * and the per-item code/name/price/pricingModel — so that any meaningful
 * change produces a different storage object (and any unchanged re-click
 * reuses the cached one).
 */
export function buildPriceListContentHash(data: PriceListRenderData): string {
  const h = createHash("sha256");
  h.update(JSON.stringify({
    name: data.name,
    footer: data.footer,
    qrUrl: data.qrUrl,
    items: data.items.map((i) => ({
      code: i.code,
      name: i.name,
      pm: i.pricingModel,
      pn: i.unitPrice?.none ?? 0,
      pm_: i.unitPrice?.member ?? 0,
    })),
  }));
  return h.digest("hex").slice(0, 16);
}

/**
 * Fetch catalog items by id, in chunks of 10 to satisfy Firestore's `in`
 * query cap. Items that have been deleted are silently skipped.
 */
async function loadCatalogItems(
  itemIds: string[]
): Promise<Map<string, CatalogItemDoc>> {
  const result = new Map<string, CatalogItemDoc>();
  if (itemIds.length === 0) return result;

  const db = getFirestore();
  // getAll accepts up to 100 refs at once and avoids the `in` query limit.
  const refs = itemIds.map((id) => db.doc(`catalog/${id}`));
  const docs = await db.getAll(...refs);
  for (const doc of docs) {
    if (!doc.exists) continue;
    result.set(doc.id, doc.data() as CatalogItemDoc);
  }
  return result;
}

export const getPriceListPdfUrl = onCall(async (request) => {
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
    (id): id is string => typeof id === "string" && id.length > 0
  );
  const catalog = await loadCatalogItems(itemIds);

  // Preserve the order from priceList.items but skip deleted ones, then
  // sort by code (numeric-aware) for a stable, human-friendly listing.
  const items: PriceListCatalogItem[] = itemIds
    .map((id) => catalog.get(id))
    .filter((doc): doc is CatalogItemDoc => doc != null)
    .map((doc) => ({
      code: doc.code,
      name: doc.name,
      pricingModel: doc.pricingModel,
      unitPrice: {
        none: doc.unitPrice?.none ?? 0,
        member: doc.unitPrice?.member ?? 0,
      },
    }))
    .sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true })
    );

  const qrUrl = `https://${checkoutDomain()}/material/add?priceList=${priceListId}`;

  const renderData: PriceListRenderData = {
    name: priceList.name,
    footer: priceList.footer ?? "",
    qrUrl,
    items,
  };

  const hash = buildPriceListContentHash(renderData);
  const storagePath = `price-lists/${priceListId}/${hash}.pdf`;
  const filename = priceListFilename(priceList.name);

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
    await file.save(pdfBuffer, { contentType: "application/pdf" });
    logger.info(
      `Generated price-list PDF ${storagePath} (${pdfBuffer.length} bytes)`
    );
  } else {
    logger.info(`Reusing cached price-list PDF ${storagePath}`);
  }

  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 3600 * 1000,
    responseDisposition: `attachment; filename="${filename}"`,
  });

  return { url };
});
