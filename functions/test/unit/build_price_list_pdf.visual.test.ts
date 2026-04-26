// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildPriceListPdf } from "../../src/price_list/build_price_list_pdf";
import {
  smallPriceList,
  mixedPriceList,
  longPriceList,
  emptyPriceList,
} from "./price_list_test_fixtures";
import type { PriceListRenderData } from "../../src/price_list/types";

// Resolve relative to source tree (not compiled lib/) so snapshots can be checked in
const SNAPSHOT_DIR = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "test",
  "unit",
  "build_price_list_pdf.visual.test.ts-snapshots"
);
const UPDATE_SNAPSHOTS = process.env.UPDATE_SNAPSHOTS === "1";
const PIXEL_THRESHOLD = 0.1; // 10% tolerance per pixel
const MAX_DIFF_PIXELS_RATIO = 0.005; // 0.5% of total pixels

// Dynamic imports for ESM-only deps (matches build_invoice_pdf.visual.test.ts)
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

async function renderPages(
  name: string,
  data: PriceListRenderData
): Promise<Buffer[]> {
  const pdfBuffer = await buildPriceListPdf(data);
  // Persist the PDF only when updating snapshots; otherwise creation-date
  // metadata churns on every run.
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
    console.log(
      `  [snapshot] ${UPDATE_SNAPSHOTS ? "Updated" : "Created"}: ${name}.png`
    );
    return;
  }

  const expected = readFileSync(snapshotPath);
  const actualPng = PNG.sync.read(actual);
  const expectedPng = PNG.sync.read(expected);

  if (
    actualPng.width !== expectedPng.width ||
    actualPng.height !== expectedPng.height
  ) {
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

async function compareAllPages(name: string, data: PriceListRenderData) {
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

describe("buildPriceListPdf — visual regression", function () {
  this.timeout(30000);

  it("small price list", async () => {
    await compareAllPages("small-price-list", smallPriceList());
  });

  it("mixed pricing models", async () => {
    await compareAllPages("mixed-price-list", mixedPriceList());
  });

  it("long list (multi-page)", async () => {
    await compareAllPages("long-price-list", longPriceList());
  });

  it("empty list", async () => {
    await compareAllPages("empty-price-list", emptyPriceList());
  });
});
