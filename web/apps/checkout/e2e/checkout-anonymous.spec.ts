// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect, type Page, type Locator } from "@playwright/test"
import { clearCollections, getCheckoutDocs } from "./helpers"

/** Locate an input field by its preceding label text within a person card */
function personField(page: Page, label: string, nth = 0): Locator {
  // Labels are <Label>Vorname<span>*</span></Label> followed by sibling <input>
  // Find the container div that has both the label and the input
  return page
    .locator(`label:has-text("${label}")`)
    .nth(nth)
    .locator("..")
    .locator("input")
}

test.beforeEach(async () => {
  await clearCollections("checkouts")
})

test.describe("Anonymous checkout", () => {
  test("full checkout flow — happy path", async ({ page }) => {
    await page.goto("/")

    // ── Landing page ──
    // Dismiss landing page
    await page
      .getByRole("button", { name: "Ohne Anmeldung fortfahren" })
      .click({ timeout: 10_000 })

    // ── Step 0: Check-in ──
    await expect(page.getByText("Deine Angaben")).toBeVisible()

    // Fill person card
    await personField(page, "Vorname").fill("Max")
    await personField(page, "Nachname").fill("Muster")
    await personField(page, "E-Mail").fill("max@test.com")

    // Accept terms
    await page.locator("#terms-accept").click()

    // Advance
    await page.getByRole("button", { name: "Weiter" }).click()

    // ── Step 1: Workshops ──
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()

    // Select "Holz" workshop
    await page.getByLabel("Holz").click()

    // Workshop section appears with "+ Artikel hinzufügen" button
    await expect(
      page.getByRole("button", { name: "Artikel hinzufügen" }),
    ).toBeVisible()

    // Proceed to checkout (with entry fee only — no items added)
    await page.getByRole("button", { name: "Check-Out" }).click()

    // ── Step 2: Checkout ──
    await expect(page.getByText("Zusammenfassung")).toBeVisible()
    await expect(page.getByText("Nutzungsgebühren")).toBeVisible()
    await expect(page.getByText("Max Muster")).toBeVisible()

    // Submit
    await page.getByRole("button", { name: "Senden & zur Kasse" }).click()

    // ── Payment result ──
    await expect(page.getByText("Vielen Dank!")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText("Zu bezahlen:")).toBeVisible()
    await expect(page.getByRole("heading", { name: "E-Banking" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Twint" })).toBeVisible()

    // ── Verify Firestore ──
    const checkouts = await getCheckoutDocs()
    expect(checkouts.length).toBeGreaterThanOrEqual(1)

    const checkout = checkouts[0] as Record<string, unknown>
    expect(checkout.status).toBe("closed")

    const persons = checkout.persons as { name: string }[]
    expect(persons[0].name).toBe("Max Muster")

    const summary = checkout.summary as { totalPrice: number }
    expect(summary.totalPrice).toBeGreaterThan(0)
  })

  test("multiple persons with different user types", async ({ page }) => {
    await page.goto("/")
    // Dismiss landing page
    await page
      .getByRole("button", { name: "Ohne Anmeldung fortfahren" })
      .click({ timeout: 10_000 })

    // Fill person 1
    await personField(page, "Vorname", 0).fill("Max")
    await personField(page, "Nachname", 0).fill("Muster")
    await personField(page, "E-Mail", 0).fill("max@test.com")

    // Add person 2
    await page.getByRole("button", { name: "Person hinzufügen" }).click()

    // Fill person 2
    await personField(page, "Vorname", 1).fill("Anna")
    await personField(page, "Nachname", 1).fill("Kind")
    await personField(page, "E-Mail", 1).fill("anna@test.com")

    // Change person 2 to "Kind (u. 18)"
    // Radio buttons are per-person, find the second group
    const kindRadios = page.getByText("Kind (u. 18)")
    await kindRadios.nth(1).click()

    // Accept terms
    await page.locator("#terms-accept").click()

    // Advance to step 1
    await page.getByRole("button", { name: "Weiter" }).click()
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()

    // Skip workshop selection, go to checkout
    await page.getByRole("button", { name: "Check-Out" }).click()

    // Verify both persons shown
    await expect(page.getByText("Max Muster")).toBeVisible()
    await expect(page.getByText("Anna Kind")).toBeVisible()
    await expect(page.getByText("Nutzungsgebühren")).toBeVisible()
  })

  test("form validation prevents advancing and shows errors", async ({ page }) => {
    await page.goto("/")
    // Dismiss landing page
    await page
      .getByRole("button", { name: "Ohne Anmeldung fortfahren" })
      .click({ timeout: 10_000 })

    await expect(page.getByText("Deine Angaben")).toBeVisible()

    // "Weiter" is always enabled (clickable)
    await expect(
      page.getByRole("button", { name: "Weiter" }),
    ).toBeEnabled()

    // Click Weiter with empty fields — shows validation errors
    await page.getByRole("button", { name: "Weiter" }).click()
    await expect(page.getByText("Vorname ist erforderlich.")).toBeVisible()
    await expect(page.getByText("Nachname ist erforderlich.")).toBeVisible()
    await expect(page.getByText("E-Mail ist erforderlich.")).toBeVisible()
    await expect(page.getByText("Nutzungsbestimmungen ist erforderlich.")).toBeVisible()

    // Still on step 0
    await expect(page.getByText("Deine Angaben")).toBeVisible()

    // Fill invalid email, blur → format error shown
    await personField(page, "Vorname").fill("Max")
    await personField(page, "Nachname").fill("Muster")
    await personField(page, "E-Mail").fill("not-valid")

    // Errors for filled fields should be gone, email format error present
    await expect(page.getByText("Vorname ist erforderlich.")).not.toBeVisible()
    await expect(
      page.getByText("E-Mail muss im Format name@address.xyz eingegeben werden."),
    ).toBeVisible()

    // Fix email
    await personField(page, "E-Mail").fill("max@test.com")
    await expect(
      page.getByText("E-Mail muss im Format name@address.xyz eingegeben werden."),
    ).not.toBeVisible()

    // Accept terms — now Weiter advances
    await page.locator("#terms-accept").click()
    await page.getByRole("button", { name: "Weiter" }).click()
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()
  })

  test("step navigation forward and back", async ({ page }) => {
    await page.goto("/")
    // Dismiss landing page
    await page
      .getByRole("button", { name: "Ohne Anmeldung fortfahren" })
      .click({ timeout: 10_000 })

    // Step 0 visible
    await expect(page.getByText("Deine Angaben")).toBeVisible()

    // Fill and advance to step 1
    await personField(page, "Vorname").fill("Max")
    await personField(page, "Nachname").fill("Muster")
    await personField(page, "E-Mail").fill("max@test.com")
    await page.locator("#terms-accept").click()
    await page.getByRole("button", { name: "Weiter" }).click()

    // Step 1 visible
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()

    // Advance to step 2
    await page.getByRole("button", { name: "Check-Out" }).click()
    await expect(page.getByText("Zusammenfassung")).toBeVisible()

    // Go back to step 1
    await page.getByRole("button", { name: "Zurück" }).click()
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()

    // Go back to step 0
    await page.getByRole("button", { name: "Zurück" }).click()
    await expect(page.getByText("Deine Angaben")).toBeVisible()
  })
})
