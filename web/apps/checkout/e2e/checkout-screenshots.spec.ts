// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect, type Page } from "@playwright/test"
import { waitForOobCode } from "./helpers"

const AUTH_USER_EMAIL = "e2e-test@werkstattwaedi.ch"

/** Navigate to checkout → fill check-in → advance to workshops */
async function goToWorkshops(page: Page) {
  await page.goto("/")
  await expect(page.getByText("Deine Angaben")).toBeVisible({ timeout: 10_000 })

  // Fill required person fields
  await page.locator('label:has-text("Vorname")').first().locator("..").locator("input").fill("Max")
  await page.locator('label:has-text("Nachname")').first().locator("..").locator("input").fill("Muster")
  await page.locator('label:has-text("E-Mail")').first().locator("..").locator("input").fill("max@test.com")
  await page.locator("#terms-accept").click()

  await page.getByRole("button", { name: "Weiter" }).click()
  await expect(page.getByText("Werkstätten wählen")).toBeVisible()
}

/** Navigate to checkout summary (step 3) with no items */
async function goToSummary(page: Page) {
  await goToWorkshops(page)
  const checkoutBtn = page.getByRole("button", { name: "Checkout", exact: true })
  await checkoutBtn.scrollIntoViewIfNeeded()
  await checkoutBtn.click()
  await expect(page.getByText("Zusammenfassung")).toBeVisible()
}

/** Navigate to checkout summary with a holz item added */
async function goToSummaryWithItems(page: Page) {
  await goToWorkshops(page)

  await page.getByLabel("Holz").click()
  const holzSection = page.locator("div.space-y-2").filter({ hasText: /^Holz/ })

  // Add count-based item (Schleifpapier, CHF 2/Stk.)
  await holzSection.getByRole("button", { name: "Artikel hinzufügen" }).click()
  await expect(page.getByText("Schleifpapier")).toBeVisible()
  await page.getByText("Schleifpapier").click()

  // Set quantity to 3 (CHF 2 × 3 = CHF 6)
  const qtyInput = page.locator('label:has-text("Anzahl")').locator("..").locator("input")
  await qtyInput.fill("3")
  await qtyInput.blur()

  const checkoutBtn = page.getByRole("button", { name: "Checkout", exact: true })
  await checkoutBtn.scrollIntoViewIfNeeded()
  await checkoutBtn.click()
  await expect(page.getByText("Zusammenfassung")).toBeVisible()
}

/** Sign in as the seeded test user */
async function signIn(page: Page) {
  await page.goto("/login")
  await page.getByPlaceholder("deine@email.ch").fill(AUTH_USER_EMAIL)
  await page.getByRole("button", { name: "Anmelde-Link senden" }).click()
  await expect(page.getByText("Anmelde-Link wurde an")).toBeVisible({ timeout: 5000 })

  const signInCode = await waitForOobCode(
    (c) => c.email === AUTH_USER_EMAIL && c.requestType === "EMAIL_SIGNIN",
  )
  expect(signInCode).toBeTruthy()
  await page.goto(signInCode!.oobLink)
  await page.waitForURL((url) => !url.href.includes("oobCode"), { timeout: 10_000 })
}

/**
 * Sign in, go through checkout, submit, and wait for payment result.
 *
 * Uses a logged-in user so the checkout updates an existing open doc
 * (open → closed), which fires the onCheckoutClosed trigger. Logged-in
 * users also have no auto-reset timer.
 */
async function submitAndWaitForPaymentResult(page: Page) {
  await signIn(page)

  // Navigate to checkout — logged-in user sees pre-filled form
  await page.goto("/")
  await expect(page.getByText("Abmelden")).toBeVisible({ timeout: 10_000 })

  // Advance to workshops
  await page.getByRole("button", { name: "Weiter" }).click()
  await expect(page.getByText("Werkstätten wählen")).toBeVisible()

  // Go to summary
  const checkoutBtn = page.getByRole("button", { name: "Checkout", exact: true })
  await checkoutBtn.scrollIntoViewIfNeeded()
  await checkoutBtn.click()
  await expect(page.getByText("Zusammenfassung")).toBeVisible()

  // Submit
  const submitBtn = page.getByRole("button", { name: "Senden & zur Kasse" })
  await submitBtn.scrollIntoViewIfNeeded()
  await submitBtn.click()

  // Wait for payment result with QR bill details
  await expect(page.getByText("Zu bezahlen")).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText("Konto / Zahlbar an")).toBeVisible({ timeout: 30_000 })
}

test.describe("Checkout step screenshots", () => {
  test("empty workshop form", async ({ page }) => {
    await goToWorkshops(page)

    await expect(page).toHaveScreenshot("checkout-workshops-empty.png")
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

    await expect(page).toHaveScreenshot("checkout-workshops-selected.png")
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

    await expect(page).toHaveScreenshot("checkout-add-article-dropdown.png")
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

    await expect(page).toHaveScreenshot("checkout-materials-added.png")
  })

  test("summary — entry fees only", async ({ page }) => {
    await goToSummary(page)

    await expect(page).toHaveScreenshot("checkout-summary-empty.png")
  })

  test("summary — with workshop items", async ({ page }) => {
    await goToSummaryWithItems(page)

    await expect(page).toHaveScreenshot("checkout-summary-items.png")
  })

  test("summary — with workshop items scrolled — sticky nav bar at bottom", async ({ page }) => {
    await goToSummaryWithItems(page)

    // Scroll down so the item list is visible above the fold and the sticky
    // payment bar is anchored to the viewport bottom (as users see it)
    await page.evaluate(() => window.scrollBy(0, 200))

    // Capture viewport only — sticky bar should appear at viewport bottom
    await expect(page).toHaveScreenshot("checkout-summary-scrolled-sticky-nav.png")
  })

  test("summary — tip with round-up", async ({ page }) => {
    await goToSummaryWithItems(page)

    // Enter a manual tip
    const tipInput = page.locator('input[type="number"][step="0.50"]')
    await tipInput.fill("1")

    // Wait for round-up options to appear
    await expect(page.getByText("Aufrunden auf")).toBeVisible()

    // Select the first round-up option
    const firstRadio = page.getByText("Aufrunden auf").locator("..").locator("label").first()
    await firstRadio.click()

    // Blur the tip input to avoid cursor blink
    await page.locator("h2").first().click()

    await expect(page).toHaveScreenshot("checkout-summary-tip.png")
  })

  test("payment result — e-banking selected", async ({ page }, testInfo) => {
    testInfo.setTimeout(60_000)
    await submitAndWaitForPaymentResult(page)

    await expect(page).toHaveScreenshot("checkout-payment-ebanking.png")
  })

  test("payment result — twint selected", async ({ page }, testInfo) => {
    testInfo.setTimeout(60_000)
    await submitAndWaitForPaymentResult(page)

    // Switch to TWINT
    await page.getByRole("button", { name: /TWINT/ }).click()
    await expect(page.getByText(/Transaktionsgebühren/)).toBeVisible()

    await expect(page).toHaveScreenshot("checkout-payment-twint.png")
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

    // Trigger validation (scrollIntoViewIfNeeded: on mobile the tall page
    // can cause the parent div to intercept Playwright's actionability check)
    const checkoutBtn = page.getByRole("button", { name: "Checkout", exact: true })
    await checkoutBtn.scrollIntoViewIfNeeded()
    await checkoutBtn.click()

    // Wait for error annotations to appear
    await expect(page.getByText("Masse müssen grösser als 0 sein.")).toBeVisible()

    await expect(page).toHaveScreenshot("checkout-validation-errors.png")
  })
})
