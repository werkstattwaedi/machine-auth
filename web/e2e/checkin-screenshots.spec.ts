// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect, type Page } from "@playwright/test"

/** Navigate to checkout and dismiss the landing page to reach check-in step */
async function goToCheckin(page: Page) {
  await page.goto("/checkout")
  await page
    .getByRole("button", { name: "Ohne Anmeldung fortfahren" })
    .click({ timeout: 10_000 })
  await expect(page.getByText("Deine Angaben")).toBeVisible()
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
})
