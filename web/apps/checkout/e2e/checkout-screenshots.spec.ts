// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect, type Page } from "@playwright/test"
import { clearCollections, waitForLoginCode } from "./helpers"

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
  const checkoutBtn = page.getByRole("button", { name: "Check-Out" })
  await checkoutBtn.scrollIntoViewIfNeeded()
  await checkoutBtn.click()
  await expect(page.getByText("Dein Besuch")).toBeVisible()
}

/** Navigate to checkout summary with a holz item added */
async function goToSummaryWithItems(page: Page) {
  await goToWorkshops(page)

  await page.getByLabel("Holz").click()
  const holzSection = page.getByTestId("workshop-block-holz")

  // Open the MaterialPicker sheet for Holz
  await holzSection.getByRole("button", { name: "Material hinzufügen" }).click()
  await expect(page.getByText("Schleifpapier")).toBeVisible()
  await page.getByText("Schleifpapier").click()

  // Set quantity to 3 (CHF 2 × 3 = CHF 6)
  const qtyInput = page.locator('label:has-text("Anzahl")').locator("..").locator("input")
  await qtyInput.fill("3")

  // Commit the row, then close the picker so the rest of the page is clickable
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click()
  await page.getByRole("button", { name: "Schliessen" }).click()
  await expect(page.locator(`[data-slot="sheet-overlay"]`)).toBeHidden()

  const checkoutBtn = page.getByRole("button", { name: "Check-Out" })
  await checkoutBtn.scrollIntoViewIfNeeded()
  await checkoutBtn.click()
  await expect(page.getByText("Dein Besuch")).toBeVisible()
}

/** Sign in as the seeded test user via the 6-digit code flow. */
async function signIn(page: Page) {
  // Drop any prior loginCodes so the per-email 60 s rate limit doesn't
  // reject back-to-back tests sharing this helper.
  await clearCollections("loginCodes")

  await page.goto("/login")
  await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
  await page.getByTestId("login-email-submit").click()
  await expect(page.getByTestId("login-code-stage")).toBeVisible({ timeout: 5000 })

  const entry = await waitForLoginCode(AUTH_USER_EMAIL)
  expect(entry).toBeTruthy()
  await page.getByTestId("login-code-input").fill(entry!.code)
  await page.getByTestId("login-code-submit").click()

  // Post-login: wait for any non-login URL.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 })
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
  const checkoutBtn = page.getByRole("button", { name: "Check-Out" })
  await checkoutBtn.scrollIntoViewIfNeeded()
  await checkoutBtn.click()
  await expect(page.getByText("Dein Besuch")).toBeVisible()

  // Submit
  const submitBtn = page.getByRole("button", { name: "Senden & bezahlen" })
  await submitBtn.scrollIntoViewIfNeeded()
  await submitBtn.click()

  // Wait for Step 4 (Bezahlen) — Rechnung flow renders the QR bill card
  await expect(
    page.getByRole("heading", { name: "QR-Rechnung scannen" }),
  ).toBeVisible({ timeout: 10_000 })
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
      page.getByRole("button", { name: "Material hinzufügen" }).first(),
    ).toBeVisible()

    await expect(page).toHaveScreenshot("checkout-workshops-selected.png")
  })

  test("add article dropdown open", async ({ page }) => {
    await goToWorkshops(page)

    await page.getByLabel("Holz").click()
    await expect(
      page.getByRole("button", { name: "Material hinzufügen" }),
    ).toBeVisible()

    // Open the add article search
    await page.getByRole("button", { name: "Material hinzufügen" }).click()

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
    const holzSection = page.getByTestId("workshop-block-holz")
    const makerSection = page.getByTestId("workshop-block-makerspace")

    // --- Add E2E Testmaterial (area pricing) in holz ---
    await holzSection
      .getByRole("button", { name: "Material hinzufügen" })
      .click()
    await expect(page.getByText("E2E Testmaterial")).toBeVisible()
    await page.getByText("E2E Testmaterial").click()
    await page.locator('label:has-text("Länge (cm)")').locator("..").locator("input").fill("60")
    await page.locator('label:has-text("Breite (cm)")').locator("..").locator("input").fill("40")
    await page.getByRole("button", { name: "Hinzufügen", exact: true }).click()
    await page.getByRole("button", { name: "Schliessen" }).click()
    await expect(page.locator(`[data-slot="sheet-overlay"]`)).toBeHidden()

    // --- Add Filament (weight pricing) in makerspace ---
    // On mobile the sticky bottom-nav can cover the add button; force: true
    // bypasses the actionability/overlap check (the button is keyboard-
    // reachable and we just want to open the picker).
    const makerAddBtn = makerSection.getByRole("button", { name: "Material hinzufügen" })
    await makerAddBtn.scrollIntoViewIfNeeded()
    await makerAddBtn.click({ force: true })
    await expect(page.getByText("Filament").first()).toBeVisible()
    // Click the first catalog button matching "Filament" (not "Filament (Spezial)")
    await page.locator("button").filter({ hasText: /^Filament/ }).first().click()
    await page.locator('label:has-text("Anzahl")').locator("..").locator("input").fill("100")
    await page.getByRole("button", { name: "Hinzufügen", exact: true }).click()
    await page.getByRole("button", { name: "Schliessen" }).click()
    await expect(page.locator(`[data-slot="sheet-overlay"]`)).toBeHidden()

    // --- Add ad-hoc Maschinenzeit (time pricing) in holz ---
    const holzAddBtn2 = holzSection.getByRole("button", { name: "Material hinzufügen" })
    await holzAddBtn2.scrollIntoViewIfNeeded()
    await holzAddBtn2.click({ force: true })
    await page.getByPlaceholder("Material suchen…").fill("Maschinennutzung")
    await page.getByText("Maschinenzeit").click()
    // Fill description, time and rate so the row commits
    await page.locator('label:has-text("Beschreibung")').locator("..").locator("input").fill("Maschinennutzung")
    await page.locator('label:has-text("Anzahl")').locator("..").locator("input").fill("60")
    await page.locator('label:has-text("Preis")').locator("..").locator("input").first().fill("20")
    await page.getByRole("button", { name: "Hinzufügen", exact: true }).click()
    await page.getByRole("button", { name: "Schliessen" }).click()
    await expect(page.locator(`[data-slot="sheet-overlay"]`)).toBeHidden()

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

    // Enter a fractional manual tip so the round-up row is still
    // exercised even when the seeded subtotal lands on a whole franc
    // (#204: whole-franc bases now hide round-up suggestions).
    const tipInput = page.getByRole("textbox", { name: "Trinkgeld/Spende" })
    await tipInput.fill("0.50")

    // The round-up row appears once there's a positive base. The dropdown
    // owns the friendly target labels ("nächsten Franken" / "X Franken").
    const targetSelect = page.getByLabel("Aufrunden-Ziel")
    await expect(targetSelect).toBeVisible()

    // Picking a target also auto-checks the "Aufrunden" checkbox.
    await targetSelect.selectOption({ index: 0 })

    // Blur the tip input to avoid cursor blink
    await page.locator("h1, h2").first().click()

    await expect(page).toHaveScreenshot("checkout-summary-tip.png")
  })

  test("summary — Nutzungsgebühren expanded (Nutzungsart + Personen)", async ({ page }) => {
    await goToSummary(page)

    // Expand the first type-of-cost row — panel shows the Nutzungsart
    // dropdown plus a "Personen" list with per-person fees.
    await page.getByRole("button", { name: /Nutzungsgebühren/ }).click()
    await expect(page.getByLabel("Nutzungsart")).toBeVisible()

    // Click a neutral spot so the screenshot is stable
    await page.locator("h1").first().click()

    await expect(page).toHaveScreenshot("checkout-summary-nutzung-expanded.png")
  })

  test("summary — Materialbezug expanded with workshop items", async ({ page }) => {
    await goToSummaryWithItems(page)

    await page.getByRole("button", { name: /Materialbezug/ }).click()
    await expect(page.getByText("Bezogenes Material")).toBeVisible()

    await page.locator("h1").first().click()

    await expect(page).toHaveScreenshot("checkout-summary-material-expanded.png")
  })

  test("summary — TWINT method selected on Step 3", async ({ page }) => {
    await goToSummaryWithItems(page)

    // Pick TWINT in the Zahlungsart picker
    await page.getByRole("button", { name: /TWINT.*Sofort bezahlen/ }).click()
    await expect(page.getByText(/Transaktionsgebühren/)).toBeVisible()

    // Scroll the method picker into view so the Empfohlen pill / TWINT body
    // is captured in the viewport screenshot.
    await page
      .getByRole("button", { name: /TWINT.*Sofort bezahlen/ })
      .scrollIntoViewIfNeeded()

    await expect(page).toHaveScreenshot("checkout-summary-method-twint.png")
  })

  test("Step 4 · Rechnung — QR bill, PDF + IBAN buttons, Fertig", async ({ page }, testInfo) => {
    testInfo.setTimeout(60_000)
    await submitAndWaitForPaymentResult(page)

    // PDF + IBAN actions are part of the Rechnung flow chrome.
    await expect(page.getByRole("button", { name: /PDF herunterladen/ })).toBeVisible()
    await expect(page.getByRole("button", { name: /IBAN kopieren/ })).toBeVisible()

    await expect(page).toHaveScreenshot("checkout-payment-ebanking.png")
  })

  test("Step 4 · TWINT — single big button, no QR bill", async ({ page }, testInfo) => {
    testInfo.setTimeout(60_000)
    await signIn(page)
    await page.goto("/")
    await expect(page.getByText("Abmelden")).toBeVisible({ timeout: 10_000 })

    await page.getByRole("button", { name: "Weiter" }).click()
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()

    const checkoutBtn = page.getByRole("button", { name: "Check-Out" })
    await checkoutBtn.scrollIntoViewIfNeeded()
    await checkoutBtn.click()
    await expect(page.getByText("Dein Besuch")).toBeVisible()

    // Pick TWINT on Step 3 before submitting
    await page.getByRole("button", { name: /TWINT.*Sofort bezahlen/ }).click()
    await expect(page.getByText(/Transaktionsgebühren/)).toBeVisible()

    const submitBtn = page.getByRole("button", { name: "Senden & bezahlen" })
    await submitBtn.scrollIntoViewIfNeeded()
    await submitBtn.click()

    // Step 4 in the TWINT flow renders the dark pay-link as the only CTA.
    await expect(
      page.getByRole("heading", { name: "Mit TWINT bezahlen" }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("link", { name: /Mit TWINT bezahlen/ })).toBeVisible({
      timeout: 30_000,
    })
    // QR bill must NOT render in the TWINT flow.
    await expect(page.getByText("Konto / Zahlbar an")).toBeHidden()

    await expect(page).toHaveScreenshot("checkout-payment-twint.png")
  })

  test("SLA row — resin + layers filled", async ({ page }) => {
    await goToWorkshops(page)

    await page.getByLabel("Maker Space").click()
    const makerSection = page.getByTestId("workshop-block-makerspace")

    // Add the SLA catalog item from the makerspace section
    await makerSection
      .getByRole("button", { name: "Material hinzufügen" })
      .click()
    await expect(page.getByText("E2E SLA Resin")).toBeVisible()
    await page.getByText("E2E SLA Resin").click()

    // Fill Resin (ml) and Layer inputs. Labels aren't associated via htmlFor,
    // so walk from label → parent → input (same idiom as existing tests).
    const resinInput = page
      .locator('label:has-text("Resin (ml)")')
      .locator("..")
      .locator("input")
    await resinInput.fill("50")
    await resinInput.blur()

    const layerInput = page
      .locator('label:has-text("Layer")')
      .locator("..")
      .locator("input")
    await layerInput.fill("1000")
    // Blur by Tabbing out — clicking outside hits the picker overlay.
    await page.keyboard.press("Tab")

    await expect(page).toHaveScreenshot("checkout-sla-filled.png")
  })

  // The pre-v5 inline-rows let users add items with zero quantity then
  // surface errors at Check-Out. The v5 MaterialPicker enforces validation
  // at add-time (Hinzufügen button disabled until inputs are valid), so
  // this submit-time error state can no longer be reached from the UI.
  // Revisit if/when an item-edit affordance returns post-add.
  test.fixme("SLA row — validation errors (empty inputs)", async ({ page }) => {
    await goToWorkshops(page)
    await page.getByLabel("Maker Space").click()
    await expect(page).toHaveScreenshot("checkout-sla-validation-errors.png")
  })

  test("summary — with SLA item", async ({ page }) => {
    await goToWorkshops(page)

    await page.getByLabel("Maker Space").click()
    const makerSection = page.getByTestId("workshop-block-makerspace")

    // Add the SLA catalog item
    await makerSection
      .getByRole("button", { name: "Material hinzufügen" })
      .click()
    await expect(page.getByText("E2E SLA Resin")).toBeVisible()
    await page.getByText("E2E SLA Resin").click()

    // Fill Resin (ml) and Layer inputs
    const resinInput = page
      .locator('label:has-text("Resin (ml)")')
      .locator("..")
      .locator("input")
    await resinInput.fill("50")

    const layerInput = page
      .locator('label:has-text("Layer")')
      .locator("..")
      .locator("input")
    await layerInput.fill("1000")

    // Commit + close picker
    await page.getByRole("button", { name: "Hinzufügen", exact: true }).click()
    await page.getByRole("button", { name: "Schliessen" }).click()
    await expect(page.locator(`[data-slot="sheet-overlay"]`)).toBeHidden()

    // Go to summary
    const checkoutBtn = page.getByRole("button", { name: "Check-Out" })
    await checkoutBtn.scrollIntoViewIfNeeded()
    await checkoutBtn.click()
    await expect(page.getByText("Dein Besuch")).toBeVisible()

    await expect(page).toHaveScreenshot("checkout-summary-sla.png")
  })

  // Same reason as "SLA row — validation errors" above: with v5's
  // MaterialPicker, items can no longer be committed with zero values,
  // so this submit-time error state is unreachable from the UI.
  test.fixme("checkout validation errors", async ({ page }) => {
    await goToWorkshops(page)
    await page.getByLabel("Holz").click()
    await expect(page).toHaveScreenshot("checkout-validation-errors.png")
  })
})
