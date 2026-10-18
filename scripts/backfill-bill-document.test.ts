// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";

import { backfillFields } from "./backfill-bill-document.ts";

const acked = { paymentMethodConfirmationTime: { seconds: 1 } };

test("a Beleg for the Sammelrechnung keeps its queue", () => {
  assert.deepEqual(backfillFields({ kind: "beleg" }, "monthly"), {
    paymentMethod: "monthly",
    document: "beleg",
  });
});

test("a TWINT bill stays a Quittung (BIL-46)", () => {
  assert.deepEqual(backfillFields({ kind: "invoice", ...acked }, "raisenow"), {
    paymentMethod: "raisenow",
    document: "quittung",
  });
});

test("the Sammelrechnung is paid by QR slip", () => {
  assert.deepEqual(backfillFields({ kind: "invoice", ...acked }, "monthly"), {
    paymentMethod: "rechnung",
    document: "sammelrechnung",
  });
});

test("a CHF 0 bill stays a Rechnung without a method", () => {
  assert.deepEqual(backfillFields({ kind: "invoice", ...acked }, null), {
    paymentMethod: null,
    document: "rechnung",
  });
});

test("an unconfirmed bill ignores the tab last tapped", () => {
  assert.deepEqual(backfillFields({ kind: "invoice" }, "raisenow"), {
    paymentMethod: null,
    document: "rechnung",
  });
});

test("a Wallee terminal bill stays a Quittung", () => {
  assert.deepEqual(backfillFields({ kind: "invoice", ...acked }, "wallee_terminal"), {
    paymentMethod: "wallee_terminal",
    document: "quittung",
  });
});
