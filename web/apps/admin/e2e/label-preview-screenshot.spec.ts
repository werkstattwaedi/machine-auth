// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"

// Pixel-level regression net for the raster label renderer
// (`@/printer/render-material-label`). The /_test/label-preview route
// renders the bitmap at native size on a white background — no auth,
// no scaling, no surrounding chrome — so the snapshot is byte-for-byte
// the same data we ship to the printer.
//
// Fixtures are entries from Mario's pricelist (the design handoff's
// materials.json), lightly edited for umlaut coverage, chosen to cover
// the layout's branches: name+mass (three lines), the no-mass centring
// case, and the only name that needs the shrink-to-fit path. Every
// label is now the same uniform length (spec 2a "Einheitslänge").
//
// If layout, fonts, QR sizing, or threshold logic ever drift, this
// fails loudly with a diff. Update snapshots with:
//   npm run test:web:e2e:update-snapshots
test.describe("Label renderer visual regression", () => {
  const fixtures = [
    {
      // Short name + mass → all three lines, ample room.
      name: "short-name",
      query: {
        url: "https://checkout.werkstattwaedi.ch/visit/add/item/3160",
        name: "MDF",
        mass: "3 mm",
        code: "#3160",
      },
    },
    {
      // Long name with umlauts + mass → full three-line at base size.
      name: "long-name-with-umlauts",
      query: {
        url: "https://checkout.werkstattwaedi.ch/visit/add/item/3156",
        name: "3-Schichtplatte, Föhre",
        mass: "19 mm",
        code: "#3156",
      },
    },
    {
      // No mass → single line, vertically centred name.
      name: "no-mass",
      query: {
        url: "https://checkout.werkstattwaedi.ch/visit/add/item/4216",
        name: "B128",
        mass: "",
        code: "#4216",
      },
    },
    {
      // The one catalog name that overflows even L at the base font size
      // and takes the shrink-to-fit path (spec: min 35 spec-px).
      name: "shrink-to-fit",
      query: {
        url: "https://checkout.werkstattwaedi.ch/visit/add/item/7004",
        name: "Siebreiniger & Siebentschichter",
        mass: "",
        code: "#7004",
      },
    },
  ]

  for (const fixture of fixtures) {
    test(`renders "${fixture.name}" deterministically`, async ({ page }) => {
      const search = new URLSearchParams(fixture.query)
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
