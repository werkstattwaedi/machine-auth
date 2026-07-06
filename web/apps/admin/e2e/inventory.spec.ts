// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { clearCollections, signInWithEmailCode } from "./helpers"
import { ADMIN_EMAIL } from "./global-setup"

test.describe("Inventar workspace", () => {
  test.beforeEach(async () => {
    await clearCollections("loginCodes")
  })

  test("browse tab lists the catalog with the import banner", async ({
    page,
  }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto("/materials")

    await expect(page.getByText(/Excel-Import/)).toBeVisible()
    await expect(page.getByText("Ahorn 30 mm")).toBeVisible()
    await expect(page.getByText("Eiche 40 mm")).toBeVisible()

    await expect(page).toHaveScreenshot("inventory-browse.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    })
  })

  test("price lists tab flags the stale Aushang", async ({ page }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto("/price-lists")

    const row = page.getByRole("row", { name: /Holz — Aushang Werkstatt/ })
    await expect(row.getByText("veraltet")).toBeVisible()

    await expect(page).toHaveScreenshot("inventory-price-lists.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    })
  })

  test("label cart: add item, preview renders, cart clears", async ({
    page,
  }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto("/materials/labels")

    // Add the first match (catalog is code-sorted, so Ahorn/3001 leads).
    await expect(page.getByText("Ahorn 30 mm")).toBeVisible()
    await page.getByRole("button", { name: "Hinzufügen" }).first().click()

    await expect(page.getByText("Etiketten-Korb · 1")).toBeVisible()
    // The WYSIWYG preview must actually rasterise.
    await expect(
      page.getByTestId("label-preview").first(),
    ).toHaveAttribute("data-ready", "true")
    await expect(
      page.getByRole("button", { name: /An Etikettendrucker senden \(1\)/ }),
    ).toBeVisible()

    await expect(page).toHaveScreenshot("inventory-labels-cart.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    })

    // "Alle Treffer hinzufügen" pulls in the rest; "Korb leeren" resets.
    await page.getByRole("button", { name: /Alle Treffer hinzufügen/ }).click()
    await expect(page.getByText("Etiketten-Korb · 2")).toBeVisible()
    await page.getByRole("button", { name: "Korb leeren" }).click()
    await expect(page.getByText("Korb ist leer")).toBeVisible()
  })
})
