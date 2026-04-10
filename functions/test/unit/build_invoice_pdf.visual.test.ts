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
  longInvoice,
  paidInvoice,
} from "./invoice_test_fixtures";
import type { InvoiceData } from "../../src/invoice/types";

if (getApps().length === 0) {
  initializeApp({ projectId: "test-project" });
}

// Resolve relative to source tree (not compiled lib/) so snapshots can be checked in
const SNAPSHOT_DIR = resolve(__dirname, "..", "..", "..", "test", "unit", "build_invoice_pdf.visual.test.ts-snapshots");
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

async function renderPages(name: string, data: InvoiceData): Promise<Buffer[]> {
  const pdfBuffer = await buildInvoicePdf(data, TEST_PAYMENT_CONFIG);
  // PDFs are written only when updating snapshots; otherwise creation-date
  // metadata would cause spurious git diffs on every test run.
  if (UPDATE_SNAPSHOTS) {
    writeFileSync(resolve(SNAPSHOT_DIR, `${name}.pdf`), pdfBuffer);
  }
  const result: Buffer[] = [];
  const pages = await pdfToImg(pdfBuffer, { scale: 2 });
  for await (const page of pages) {
    result.push(page);
  }
  return result;
}

function comparePage(name: string, actual: Buffer) {
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
    writeFileSync(resolve(SNAPSHOT_DIR, `${name}-actual.png`), actual);
    throw new Error(
      `Visual regression for ${name}: ${diffPixels} pixels differ ` +
      `(${(diffRatio * 100).toFixed(2)}% > ${(MAX_DIFF_PIXELS_RATIO * 100).toFixed(2)}% threshold). ` +
      `Actual saved to ${name}-actual.png. Run with UPDATE_SNAPSHOTS=1 to update.`
    );
  }
}

/**
 * Compare all pages of a PDF against snapshots.
 * Single-page PDFs use "{name}.png", multi-page use "{name}-p1.png", "{name}-p2.png", etc.
 */
async function compareAllPages(name: string, data: InvoiceData) {
  const pages = await renderPages(name, data);
  expect(pages.length).to.be.greaterThan(0, "PDF should have at least one page");

  if (pages.length === 1) {
    comparePage(name, pages[0]);
  } else {
    for (let i = 0; i < pages.length; i++) {
      comparePage(`${name}-p${i + 1}`, pages[i]);
    }
  }
}

describe("buildInvoicePdf — visual regression", function () {
  this.timeout(30000);

  it("single checkout (erwachsen)", async () => {
    await compareAllPages("single-checkout-erwachsen", singleCheckoutInvoice());
  });

  it("single checkout (firma with billing address)", async () => {
    await compareAllPages("single-checkout-firma", firmaCheckoutInvoice());
  });

  it("multi-checkout", async () => {
    await compareAllPages("multi-checkout", multiCheckoutInvoice());
  });

  it("checkout with tip", async () => {
    await compareAllPages("checkout-with-tip", checkoutWithTipInvoice());
  });

  it("long invoice (all pricing models)", async () => {
    await compareAllPages("long-invoice", longInvoice());
  });

  it("paid invoice (TWINT)", async () => {
    await compareAllPages("paid-twint", paidInvoice());
  });
});
