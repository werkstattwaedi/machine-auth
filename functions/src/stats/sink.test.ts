// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the BigQuery sink's NUMERIC clamp.
 *
 * Regression net for the 2026-08-28 export outage: an `area` checkout item
 * stored `quantity: 0.25680000000000003` (1.07 m × 0.24 m in JS floats),
 * BigQuery NUMERIC rejected it, and because `insertAll` defaults to
 * `skipInvalidRows: false` the whole batch failed — freezing the watermark so
 * every subsequent nightly run failed identically.
 */

import { expect } from "chai";
import { clampNumericFields } from "./sink";

describe("clampNumericFields", () => {
  it("rounds a NUMERIC field that exceeds BigQuery's 9-digit scale", () => {
    const [row] = clampNumericFields("visit_items", [
      { doc_id: "a/b", quantity: 0.25680000000000003 },
    ]);
    expect(row.quantity).to.equal(0.2568);
    // The literal BigQuery rejects is exactly what JSON.stringify would emit.
    expect(JSON.stringify(row.quantity)).to.equal("0.2568");
  });

  it("leaves rows untouched when nothing needs clamping", () => {
    const rows = [{ doc_id: "a/b", quantity: 1, total_price: 14.52 }];
    // Same row objects back — no needless copy of a 500-row batch.
    expect(clampNumericFields("visit_items", rows)[0]).to.equal(rows[0]);
  });

  it("clamps every NUMERIC column, not just quantity", () => {
    const [row] = clampNumericFields("visits", [
      { doc_id: "c", total_price: 0.1 + 0.2, tip: 0.94 },
    ]);
    expect(row.total_price).to.equal(0.3);
    expect(row.tip).to.equal(0.94);
  });

  it("ignores non-numeric and null values", () => {
    const [row] = clampNumericFields("visit_items", [
      { doc_id: "a/b", quantity: null, unit_price: undefined },
    ]);
    expect(row.quantity).to.equal(null);
    expect(row.unit_price).to.equal(undefined);
  });

  it("drops non-finite values to NULL and reports them", () => {
    const seen: Array<[string, number]> = [];
    const [row] = clampNumericFields(
      "visit_items",
      [{ doc_id: "a/b", quantity: NaN, total_price: Infinity, unit_price: 3 }],
      (field, value) => seen.push([field, value])
    );
    expect(row.quantity).to.equal(null);
    expect(row.total_price).to.equal(null);
    expect(row.unit_price).to.equal(3);
    expect(seen.map(([f]) => f)).to.deep.equal(["quantity", "total_price"]);
  });

  it("passes through tables with no NUMERIC columns", () => {
    const rows = [{ doc_id: "u", active_seconds: 42 }];
    expect(clampNumericFields("machine_usage", rows)).to.equal(rows);
  });
});
