// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect, type Page } from "@playwright/test"

/** Navigate to checkout → dismiss landing → fill check-in → advance to workshops */
async function goToWorkshops(page: Page) {
  await page.goto("/checkout")
  await page
    .getByRole("button", { name: "Ohne Anmeldung fortfahren" })
    .click({ timeout: 10_000 })
  await expect(page.getByText("Deine Angaben")).toBeVisible()

  // Fill required person fields
  await page.locator('label:has-text("Vorname")').first().locator("..").locator("input").fill("Max")
  await page.locator('label:has-text("Nachname")').first().locator("..").locator("input").fill("Muster")
  await page.locator('label:has-text("E-Mail")').first().locator("..").locator("input").fill("max@test.com")
  await page.locator("#terms-accept").click()

  await page.getByRole("button", { name: "Weiter" }).click()
  await expect(page.getByText("Werkstätten wählen")).toBeVisible()
}

test.describe("Checkout step screenshots", () => {
  test("empty workshop form", async ({ page }) => {
    await goToWorkshops(page)

    await expect(page).toHaveScreenshot("checkout-workshops-empty.png", {
      fullPage: true,
    })
  })

  test("holz and makerspace selected", async ({ page }) => {
    await goToWorkshops(page)

    await page.getByLabel("Holz").click()
    await page.getByLabel("Maker Space").click()

    // Wait for both workshop sections to appear
    await expect(page.getByText("Holz").first()).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Artikel hinzufügen" }).first(),
    ).toBeVisible()

    await expect(page).toHaveScreenshot("checkout-workshops-selected.png", {
      fullPage: true,
    })
  })

  test("add article dropdown open", async ({ page }) => {
    await goToWorkshops(page)

    await page.getByLabel("Holz").click()
    await expect(
      page.getByRole("button", { name: "Artikel hinzufügen" }),
    ).toBeVisible()

    // Open the add article search
    await page.getByRole("button", { name: "Artikel hinzufügen" }).click()

    // Wait for dropdown to be visible
    await expect(page.getByText("E2E Testmaterial")).toBeVisible()

    // Press Tab to highlight the first item instead of blinking cursor
    await page.keyboard.press("Tab")

    await expect(page).toHaveScreenshot("checkout-add-article-dropdown.png", {
      fullPage: true,
    })
  })

  test("materials added with ad-hoc item", async ({ page }) => {
    await goToWorkshops(page)

    // Select holz + makerspace
    await page.getByLabel("Holz").click()
    await page.getByLabel("Maker Space").click()

    // Locate workshop sections by their heading
    const holzSection = page.locator("div.space-y-2").filter({ hasText: /^Holz/ })
    const makerSection = page.locator("div.space-y-2").filter({ hasText: /^Maker Space/ })

    // --- Add first material in holz ---
    await holzSection
      .getByRole("button", { name: "Artikel hinzufügen" })
      .click()
    await expect(page.getByText("E2E Testmaterial")).toBeVisible()
    await page.getByText("E2E Testmaterial").click()

    // --- Add filament in makerspace ---
    await makerSection
      .getByRole("button", { name: "Artikel hinzufügen" })
      .click()
    await expect(page.getByText("Filament").first()).toBeVisible()
    // Click the first catalog button matching "Filament" (not "Filament (Spezial)")
    await page.locator("button").filter({ hasText: /^Filament/ }).first().click()

    // --- Add ad-hoc item for machine hour in holz ---
    await holzSection
      .getByRole("button", { name: "Artikel hinzufügen" })
      .click()
    // Type a custom description
    await page
      .getByPlaceholder("Material suchen (Name oder Code)...")
      .fill("Maschinennutzung")
    // Select the "h" (time/Maschinenzeit) fallback
    await page.getByText("Maschinenzeit").click()

    await expect(page).toHaveScreenshot("checkout-materials-added.png", {
      fullPage: true,
    })
  })

  test("checkout validation errors", async ({ page }) => {
    await goToWorkshops(page)

    // Build the same state as "materials added" — all items have quantity 0
    await page.getByLabel("Holz").click()
    await page.getByLabel("Maker Space").click()

    const holzSection = page.locator("div.space-y-2").filter({ hasText: /^Holz/ })
    const makerSection = page.locator("div.space-y-2").filter({ hasText: /^Maker Space/ })

    // Add area-based material in holz (will show two dimension field errors)
    await holzSection
      .getByRole("button", { name: "Artikel hinzufügen" })
      .click()
    await expect(page.getByText("E2E Testmaterial")).toBeVisible()
    await page.getByText("E2E Testmaterial").click()

    // Add filament in makerspace (weight, quantity 0 → error)
    await makerSection
      .getByRole("button", { name: "Artikel hinzufügen" })
      .click()
    await expect(page.getByText("Filament").first()).toBeVisible()
    await page.locator("button").filter({ hasText: /^Filament/ }).first().click()

    // Add ad-hoc machine hour in holz (time, quantity 0 + price 0 → errors)
    await holzSection
      .getByRole("button", { name: "Artikel hinzufügen" })
      .click()
    await page
      .getByPlaceholder("Material suchen (Name oder Code)...")
      .fill("Maschinennutzung")
    await page.getByText("Maschinenzeit").click()

    // Trigger validation
    await page.getByRole("button", { name: "Check-Out" }).click()

    // Wait for error annotations to appear
    await expect(page.getByText("Masse müssen grösser als 0 sein.")).toBeVisible()

    await expect(page).toHaveScreenshot("checkout-validation-errors.png", {
      fullPage: true,
    })
  })
})
