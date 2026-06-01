// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createHash } from "node:crypto";
import type {
  PriceListCatalogItem,
  PriceListRenderData,
  PricingModel,
} from "./types";

/**
 * Domain hosting the public checkout app (e.g. `checkout.werkstattwaedi.ch`).
 *
 * Used to build the QR-code deep link printed on the price list PDF.
 * Set via Firebase Functions params and materialised into
 * `functions/.env.<projectId>` by `scripts/generate-env.ts`. Has no
 * default — an unset param must fail loudly in production (see
 * `assertCheckoutDomainConfigured`) instead of silently shipping
 * `localhost:5173`, which is exactly how this bug regressed in #248.
 *
 * In emulator mode (`FUNCTIONS_EMULATOR === "true"`) we fall back to
 * `localhost:5173` so dev/test flows work without operations config.
 */
const checkoutDomainParam = defineString("CHECKOUT_DOMAIN", { default: "" });

function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

/**
 * Throws a distinct `failed-precondition` error when `CHECKOUT_DOMAIN`
 * is empty/whitespace in non-emulator mode. Surfaces the misconfiguration
 * in Cloud Functions logs so ops can detect it quickly — silently falling
 * back to `localhost:5173` is what produced the unusable QR codes that
 * issue #248 reports.
 *
 * Exported separately so unit tests can pass the value directly without
 * stubbing `defineString`.
 */
export function assertCheckoutDomainConfigured(value: string): void {
  if (isEmulator()) return;
  if (value.trim().length > 0) return;
  logger.error(
    "CHECKOUT_DOMAIN is empty in production — price-list QR codes would " +
      "point at localhost. Set the param via firebase functions:config or " +
      "regenerate functions/.env.<projectId> via `npm run generate-env`."
  );
  throw new HttpsError(
    "failed-precondition",
    "CHECKOUT_DOMAIN is not configured"
  );
}

/**
 * Build the public deep link encoded in the price-list QR code.
 *
 * Pure string builder — exported so unit tests can verify the canonical
 * shape without spinning up the Functions runtime / stubbing
 * `defineString`.
 */
export function buildPriceListQrUrl(
  domain: string,
  priceListId: string
): string {
  return `https://${domain}/visit/add/list/${priceListId}`;
}

/**
 * Resolve the checkout domain at request time:
 * - In emulator mode, default to `localhost:5173` when unset so dev flows
 *   work without operations config.
 * - In production, require the param to be set (asserted before use).
 */
function resolveCheckoutDomain(): string {
  const value = checkoutDomainParam.value();
  if (isEmulator() && value.trim().length === 0) {
    return "localhost:5173";
  }
  assertCheckoutDomainConfigured(value);
  return value;
}

interface PriceListDoc {
  name: string;
  footer?: string | null;
  items?: string[];
  active?: boolean;
}

interface CatalogVariant {
  id: string;
  label: string;
  pricingModel: PricingModel;
  unitPrice?: { default?: number; member?: number };
}

interface CatalogItemDoc {
  code: string;
  name: string;
  variants?: CatalogVariant[];
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

export const getPriceListPdfUrlHandler = async (request: CallableRequest<unknown>) => {
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
  // For now we render one row per catalog item, using the canonical variant
  // (variants[0]). Multi-variant items (e.g. Makerspace plywood with m² +
  // Zuschnitt options) collapse to their primary in the price-list PDF —
  // PR C can expand this into a per-variant render when the picker UI
  // grows variant support.
  const items: PriceListCatalogItem[] = itemIds
    .map((id) => catalog.get(id))
    .filter((doc): doc is CatalogItemDoc => doc != null)
    .map((doc) => {
      const primary = doc.variants?.[0];
      const defaultPrice = primary?.unitPrice?.default ?? 0;
      const memberPrice =
        typeof primary?.unitPrice?.member === "number"
          ? primary.unitPrice.member
          : defaultPrice;
      return {
        code: doc.code,
        name: doc.name,
        pricingModel: primary?.pricingModel ?? "direct",
        unitPrice: { none: defaultPrice, member: memberPrice },
      };
    })
    .sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true })
    );

  const qrUrl = buildPriceListQrUrl(resolveCheckoutDomain(), priceListId);

  const renderData: PriceListRenderData = {
    name: priceList.name,
    footer: priceList.footer ?? "",
    qrUrl,
    items,
  };

  // Lazy import: pdfkit + qrcode (~7 MB) shouldn't be paid by every
  // other function's cold start. Only this admin-only path needs them.
  const { buildPriceListPdf, priceListFilename } = await import(
    "./build_price_list_pdf.js"
  );

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
};
