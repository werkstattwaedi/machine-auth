// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, getApps } from "firebase-admin/app";
import { buildInvoicePdf } from "../../src/invoice/build_invoice_pdf";
import {
  TEST_PAYMENT_CONFIG,
  singleCheckoutInvoice,
  firmaCheckoutInvoice,
  multiCheckoutInvoice,
  checkoutWithTipInvoice,
} from "./invoice_test_fixtures";
import type { InvoiceData } from "../../src/invoice/types";

if (getApps().length === 0) {
  initializeApp({ projectId: "test-project" });
}

const SNAPSHOT_DIR = resolve(__dirname, "build_invoice_pdf.visual.test.ts-snapshots");
const UPDATE_SNAPSHOTS = process.env.UPDATE_SNAPSHOTS === "1";
const PIXEL_THRESHOLD = 0.1; // 10% tolerance
const MAX_DIFF_PIXELS_RATIO = 0.005; // 0.5% of total pixels

// Dynamic imports for ESM-only deps
let pdfToImg: any;
let pixelmatch: any;
let PNG: any;

before(async () => {
  const pdfModule = await import("pdf-to-img");
  pdfToImg = pdfModule.pdf;
  const pmModule = await import("pixelmatch");
  pixelmatch = pmModule.default;
  const pngjsModule = await import("pngjs");
  PNG = pngjsModule.PNG;

  if (!existsSync(SNAPSHOT_DIR)) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
});

async function renderFirstPage(data: InvoiceData): Promise<Buffer> {
  const pdfBuffer = await buildInvoicePdf(data, TEST_PAYMENT_CONFIG);
  const pages = await pdfToImg(pdfBuffer, { scale: 2 });
  for await (const page of pages) {
    return page; // return first page only
  }
  throw new Error("PDF has no pages");
}

async function compareSnapshot(name: string, data: InvoiceData) {
  const actual = await renderFirstPage(data);
  const snapshotPath = resolve(SNAPSHOT_DIR, `${name}.png`);

  if (UPDATE_SNAPSHOTS || !existsSync(snapshotPath)) {
    writeFileSync(snapshotPath, actual);
    console.log(`  [snapshot] ${UPDATE_SNAPSHOTS ? "Updated" : "Created"}: ${name}.png`);
    return;
  }

  const expected = readFileSync(snapshotPath);
  const actualPng = PNG.sync.read(actual);
  const expectedPng = PNG.sync.read(expected);

  if (actualPng.width !== expectedPng.width || actualPng.height !== expectedPng.height) {
    if (UPDATE_SNAPSHOTS) {
      writeFileSync(snapshotPath, actual);
      return;
    }
    throw new Error(
      `Snapshot size mismatch for ${name}: ` +
      `expected ${expectedPng.width}x${expectedPng.height}, ` +
      `got ${actualPng.width}x${actualPng.height}. ` +
      `Run with UPDATE_SNAPSHOTS=1 to update.`
    );
  }

  const diffPixels = pixelmatch(
    actualPng.data,
    expectedPng.data,
    null,
    actualPng.width,
    actualPng.height,
    { threshold: PIXEL_THRESHOLD }
  );

  const totalPixels = actualPng.width * actualPng.height;
  const diffRatio = diffPixels / totalPixels;

  if (diffRatio > MAX_DIFF_PIXELS_RATIO) {
    // Write actual for inspection
    writeFileSync(resolve(SNAPSHOT_DIR, `${name}-actual.png`), actual);
    throw new Error(
      `Visual regression for ${name}: ${diffPixels} pixels differ ` +
      `(${(diffRatio * 100).toFixed(2)}% > ${(MAX_DIFF_PIXELS_RATIO * 100).toFixed(2)}% threshold). ` +
      `Actual saved to ${name}-actual.png. Run with UPDATE_SNAPSHOTS=1 to update.`
    );
  }
}

describe("buildInvoicePdf — visual regression", function () {
  this.timeout(30000);

  it("single checkout (erwachsen)", async () => {
    await compareSnapshot("single-checkout-erwachsen", singleCheckoutInvoice());
  });

  it("single checkout (firma with billing address)", async () => {
    await compareSnapshot("single-checkout-firma", firmaCheckoutInvoice());
  });

  it("multi-checkout", async () => {
    await compareSnapshot("multi-checkout", multiCheckoutInvoice());
  });

  it("checkout with tip", async () => {
    await compareSnapshot("checkout-with-tip", checkoutWithTipInvoice());
  });
});
