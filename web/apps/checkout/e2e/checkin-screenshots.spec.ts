// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect, type Page } from "@playwright/test"
import { getAuthOobCodes } from "./helpers"
import { AUTH_USER_EMAIL } from "./global-setup"

/** Navigate to checkout — check-in step is shown directly */
async function goToCheckin(page: Page) {
  await page.goto("/")
  await expect(page.getByText("Deine Angaben")).toBeVisible({ timeout: 10_000 })
}

test.describe("Check-in step screenshots", () => {
  test("empty form", async ({ page }) => {
    await goToCheckin(page)

    await expect(page).toHaveScreenshot("checkin-empty.png", {
      fullPage: true,
    })
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

    await expect(page).toHaveScreenshot("checkin-two-persons-company.png", {
      fullPage: true,
    })
  })

  test("validation errors after submit", async ({ page }) => {
    await goToCheckin(page)

    // Click Weiter without filling anything
    await page.getByRole("button", { name: "Weiter" }).click()

    // Wait for error messages to appear
    await expect(page.getByText("Vorname ist erforderlich.")).toBeVisible()

    await expect(page).toHaveScreenshot("checkin-validation-errors.png", {
      fullPage: true,
    })
  })

  test("anonymous browser — login hint visible", async ({ page }) => {
    await goToCheckin(page)

    await expect(page.getByText("Bereits registriert?")).toBeVisible()

    await expect(page).toHaveScreenshot("checkin-login-hint.png", {
      fullPage: true,
    })
  })

  test("kiosk mode — NFC hint visible", async ({ page }) => {
    await page.goto("/?kiosk")
    await expect(page.getByText("Deine Angaben")).toBeVisible({ timeout: 10_000 })

    await expect(
      page.getByText("Badge an den Leser halten, um deine Daten zu laden"),
    ).toBeVisible()

    await expect(page).toHaveScreenshot("checkin-kiosk-nfc-hint.png", {
      fullPage: true,
    })
  })

  test("logged-in user — sign-out in person card", async ({ page }) => {
    // Sign in via /login
    await page.goto("/login")
    await page.getByPlaceholder("deine@email.ch").fill(AUTH_USER_EMAIL)
    await page.getByRole("button", { name: "Anmelde-Link senden" }).click()
    await expect(page.getByText("Anmelde-Link wurde an")).toBeVisible({ timeout: 5000 })

    const oobCodes = await getAuthOobCodes()
    const signInCode = oobCodes.find(
      (c) => c.email === AUTH_USER_EMAIL && c.requestType === "EMAIL_SIGNIN",
    )
    expect(signInCode).toBeTruthy()
    await page.goto(signInCode!.oobLink)
    await page.waitForURL((url) => !url.href.includes("oobCode"), { timeout: 10_000 })

    // Navigate to checkout
    await page.goto("/")
    await expect(page.getByText("Abmelden")).toBeVisible({ timeout: 10_000 })

    await expect(page).toHaveScreenshot("checkin-logged-in.png", {
      fullPage: true,
    })
  })
})
