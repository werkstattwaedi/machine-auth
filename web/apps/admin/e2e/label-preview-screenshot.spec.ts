// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"

// Pixel-level regression net for the raster label renderer
// (`@/printer/render-material-label`). The /_test/label-preview route
// renders the bitmap at native size on a white background — no auth,
// no scaling, no surrounding chrome — so the snapshot is byte-for-byte
// the same data we ship to the printer.
//
// If layout, fonts, QR sizing, or threshold logic ever drift, this
// fails loudly with a diff. Update snapshots with:
//   npm run test:web:e2e:update-snapshots
test.describe("Label renderer visual regression", () => {
  const fixtures = [
    {
      name: "short-name",
      query: {
        url: "https://checkout.werkstattwaedi.ch/visit/add/item/6011",
        title: "MDF roh 3mm",
        code: "#6011",
      },
    },
    {
      name: "long-name-with-umlauts",
      query: {
        url: "https://checkout.werkstattwaedi.ch/visit/add/item/4103",
        title: "Schraube für Korpusverbinder M6×40",
        code: "#4103",
      },
    },
    {
      name: "raku-rohling",
      query: {
        url: "https://checkout.werkstattwaedi.ch/visit/add/item/4103",
        title: "Raku Rohling Schale Ø150mm",
        code: "#4103",
      },
    },
  ]

  for (const fixture of fixtures) {
    test(`renders "${fixture.name}" deterministically`, async ({ page }) => {
      const search = new URLSearchParams({
        url: fixture.query.url,
        title: fixture.query.title,
        code: fixture.query.code,
      })
      // `_test` is a TanStack pathless layout group, so the URL is just
      // `/label-preview` (the route file lives at routes/_test.label-preview.tsx
      // to signal "test-only" but doesn't contribute a URL segment).
      await page.goto(`/label-preview?${search.toString()}`)

      // Wait for fonts to load AND the canvas to be painted from the
      // bitmap. `useLabelBitmap` flips `data-ready` to "true" once the
      // bitmap is in state and the paint useEffect has run.
      const preview = page.getByTestId("label-preview")
      await expect(preview).toHaveAttribute("data-ready", "true")
      const canvas = page.getByTestId("label-preview-canvas")
      await expect(canvas).toBeVisible()

      // Screenshot just the canvas, native pixel size. 0 tolerance:
      // the rasterised output is a 1-bit bitmap painted via
      // `putImageData` (no antialiasing), so any per-pixel drift is a
      // real regression in the renderer.
      await expect(canvas).toHaveScreenshot(`label-${fixture.name}.png`, {
        maxDiffPixelRatio: 0,
        animations: "disabled",
      })
    })
  }
})
