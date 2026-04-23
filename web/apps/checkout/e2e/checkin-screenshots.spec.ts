// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect, type Page } from "@playwright/test"
import { clearCollections, waitForLoginCode } from "./helpers"
import { AUTH_USER_EMAIL } from "./global-setup"

/** Navigate to checkout — check-in step is shown directly */
async function goToCheckin(page: Page) {
  await page.goto("/")
  await expect(page.getByText("Deine Angaben")).toBeVisible({ timeout: 10_000 })
}

test.describe("Check-in step screenshots", () => {
  test("empty form", async ({ page }) => {
    await goToCheckin(page)

    await expect(page).toHaveScreenshot("checkin-empty.png")
  })

  test("two persons with company type", async ({ page }) => {
    await goToCheckin(page)

    // Add second person
    await page.getByRole("button", { name: "Person hinzufügen" }).click()
    await expect(page.getByText("Person 2")).toBeVisible()

    // Set second person to Firma
    const person2 = page.getByTestId("person-card").nth(1)
    await person2.getByText("Firma").click()

    // Wait for billing address fields to appear
    await expect(person2.getByText("Rechnungsadresse")).toBeVisible()

    await expect(page).toHaveScreenshot("checkin-two-persons-company.png")
  })

  test("validation errors after submit", async ({ page }) => {
    await goToCheckin(page)

    // Click Weiter without filling anything
    await page.getByRole("button", { name: "Weiter" }).click()

    // Wait for error messages to appear
    await expect(page.getByText("Vorname ist erforderlich.")).toBeVisible()

    await expect(page).toHaveScreenshot("checkin-validation-errors.png")
  })

  test("anonymous browser — login hint visible", async ({ page }) => {
    await goToCheckin(page)

    await expect(page.getByText("Bereits registriert oder Konto erstellen?")).toBeVisible()

    await expect(page).toHaveScreenshot("checkin-login-hint.png")
  })

  test("kiosk mode — NFC hint visible", async ({ page }) => {
    await page.goto("/?kiosk")
    await expect(page.getByText("Deine Angaben")).toBeVisible({ timeout: 10_000 })

    await expect(
      page.getByText("Badge an den Leser halten, um deine Daten zu laden"),
    ).toBeVisible()

    await expect(page).toHaveScreenshot("checkin-kiosk-nfc-hint.png")
  })

  test("logged-in user — sign-out in person card", async ({ page }) => {
    // Clear prior loginCodes so the per-email 60 s rate limit doesn't
    // reject this test when it follows another that signed in.
    await clearCollections("loginCodes")

    // Sign in via /login (6-digit code flow)
    await page.goto("/login")
    await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
    await page.getByTestId("login-email-submit").click()
    await expect(page.getByTestId("login-code-stage")).toBeVisible({ timeout: 5000 })

    const entry = await waitForLoginCode(AUTH_USER_EMAIL)
    expect(entry).toBeTruthy()
    await page.getByTestId("login-code-input").fill(entry!.code)
    await page.getByTestId("login-code-submit").click()

    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 })

    // Navigate to checkout
    await page.goto("/")
    await expect(page.getByText("Abmelden")).toBeVisible({ timeout: 10_000 })

    await expect(page).toHaveScreenshot("checkin-logged-in.png")
  })

  test("two persons scrolled — sticky nav bar at bottom", async ({ page }) => {
    await goToCheckin(page)

    // Add second person so the page content is taller than the viewport
    await page.getByRole("button", { name: "Person hinzufügen" }).click()
    await expect(page.getByText("Person 2")).toBeVisible()

    // Scroll down so content above the fold is visible and sticky nav is at bottom
    await page.evaluate(() => window.scrollBy(0, 300))

    // Capture viewport only — shows sticky buttons anchored to viewport bottom
    await expect(page).toHaveScreenshot("checkin-scrolled-sticky-nav.png")
  })
})
