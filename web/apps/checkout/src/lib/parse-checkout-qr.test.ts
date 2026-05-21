// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { parseCheckoutQr } from "./parse-checkout-qr"

describe("parseCheckoutQr", () => {
  describe("price-list QRs", () => {
    it("parses a full prod URL", () => {
      expect(
        parseCheckoutQr(
          "https://checkout.werkstattwaedi.ch/visit/add/list/abc123",
        ),
      ).toEqual({ kind: "list", listId: "abc123" })
    })

    it("parses a path-only string", () => {
      expect(parseCheckoutQr("/visit/add/list/abc123")).toEqual({
        kind: "list",
        listId: "abc123",
      })
    })

    it("does not care which host the URL points at", () => {
      // A prod-printed QR scanned in preview/staging/dev should still
      // route locally — the parser is intentionally host-agnostic.
      expect(
        parseCheckoutQr("https://preview.example.com/visit/add/list/abc123"),
      ).toEqual({ kind: "list", listId: "abc123" })
      expect(
        parseCheckoutQr("http://localhost:5173/visit/add/list/abc123"),
      ).toEqual({ kind: "list", listId: "abc123" })
    })

    it("strips query and fragment", () => {
      expect(
        parseCheckoutQr(
          "https://checkout.werkstattwaedi.ch/visit/add/list/abc123?x=1#y",
        ),
      ).toEqual({ kind: "list", listId: "abc123" })
    })
  })

  describe("item QRs", () => {
    it("parses item without variant", () => {
      expect(parseCheckoutQr("/visit/add/item/SKU-42")).toEqual({
        kind: "item",
        code: "SKU-42",
      })
    })

    it("parses item with variant", () => {
      expect(parseCheckoutQr("/visit/add/item/SKU-42/v1")).toEqual({
        kind: "itemVariant",
        code: "SKU-42",
        variantId: "v1",
      })
    })
  })

  describe("workshop QRs", () => {
    it("parses workshop", () => {
      expect(parseCheckoutQr("/visit/add/workshop/holz")).toEqual({
        kind: "workshop",
        workshopId: "holz",
      })
    })
  })

  describe("rejections", () => {
    it.each([
      ["empty string", ""],
      ["random text", "hello world"],
      ["non-werkstatt URL", "https://example.com/foo/bar"],
      ["wrong prefix", "/checkout/add/list/abc"],
      ["unknown kind", "/visit/add/category/abc"],
      ["bare /visit/add", "/visit/add"],
      ["list with extra segment", "/visit/add/list/abc/extra"],
      ["item with too many segments", "/visit/add/item/SKU-42/v1/extra"],
      ["malformed URL", "https://[not-a-url"],
      ["wifi QR", "WIFI:T:WPA;S:home;P:secret;;"],
    ])("returns null for %s", (_label, input) => {
      expect(parseCheckoutQr(input)).toBeNull()
    })
  })
})
