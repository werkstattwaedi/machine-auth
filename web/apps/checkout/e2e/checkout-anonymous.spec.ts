// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect, type Page, type Locator } from "@playwright/test"
import {
  clearCollections,
  getBillDocs,
  getCheckoutDocs,
  getCheckoutItems,
  openGuestSection,
} from "./helpers"

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

    // ── Step 0: Check-in (no landing gate) ──
    await openGuestSection(page)

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
    await page.getByRole("button", { name: "Holz", exact: true }).click()

    // Workshop section appears with "+ Material hinzufügen" button
    await expect(
      page.getByRole("button", { name: "Material hinzufügen" }),
    ).toBeVisible()

    // Proceed to checkout (with entry fee only — no items added)
    await page.getByRole("button", { name: "Zum Checkout" }).click()

    // ── Step 2: Checkout ──
    await expect(page.getByText("Dein Besuch")).toBeVisible()
    await expect(page.getByText("Nutzungsgebühren")).toBeVisible()
    // Expand the collapsible user details section to verify person is listed
    await page.getByRole("button", { name: /Nutzungsgebühren/ }).click()
    await expect(page.getByText("Max Muster")).toBeVisible()

    // Submit
    await page.getByRole("button", { name: "Weiter zum Bezahlen" }).click()

    // ── Payment result (Step 4 — Rechnung tab is selected by default) ──
    await expect(page.getByText("Zu bezahlen")).toBeVisible({
      timeout: 10_000,
    })
    // QR card + action buttons render once the bill is created server-side
    // (onCheckoutCreatedClosed trigger) and getPaymentQrData resolves —
    // emulator cold starts can take a few seconds.
    await expect(page.getByText("Konto / Zahlbar an")).toBeVisible({
      timeout: 30_000,
    })
    // PDF download is the hero-level lightweight button (always visible).
    await expect(page.getByRole("button", { name: /Rechnung als PDF/ })).toBeVisible()

    // ── Commit the chosen payment method (records the customer's
    // acknowledgement on the closed checkout doc, then the wizard resets) ──
    await page
      .getByRole("button", {
        name: /Ich zahle die QR-Rechnung & Werkstatt verlassen/,
      })
      .click()

    // ── Verify Firestore ──
    // Wait for the bill ack write to land before reading the doc. The
    // callable stamps both the checkout's paymentMethod and the bill's
    // paymentMethodConfirmationTime / Source in one transaction.
    await expect
      .poll(
        async () => {
          const docs = await getBillDocs()
          const b = docs[0] as Record<string, unknown> | undefined
          return b?.paymentMethodConfirmationSource
        },
        { timeout: 10_000 },
      )
      .toBe("user")

    const checkouts = await getCheckoutDocs()
    expect(checkouts.length).toBeGreaterThanOrEqual(1)

    const checkout = checkouts[0] as Record<string, unknown>
    expect(checkout.status).toBe("closed")
    expect(checkout.paymentMethod).toBe("rechnung")

    const bills = await getBillDocs()
    expect(bills.length).toBeGreaterThanOrEqual(1)
    const bill = bills[0] as Record<string, unknown>
    expect(bill.paymentMethodConfirmationTime).toBeDefined()
    expect(bill.paymentMethodConfirmationSource).toBe("user")

    const persons = checkout.persons as { name: string }[]
    expect(persons[0].name).toBe("Max Muster")

    const summary = checkout.summary as { totalPrice: number }
    expect(summary.totalPrice).toBeGreaterThan(0)
  })

  test("multiple persons with different user types", async ({ page }) => {
    await page.goto("/")
    await openGuestSection(page)

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
    await page.getByRole("button", { name: "Zum Checkout" }).click()

    // Verify both persons shown (expand the collapsible section first)
    await expect(page.getByText("Nutzungsgebühren")).toBeVisible()
    await page.getByRole("button", { name: /Nutzungsgebühren/ }).click()
    await expect(page.getByText("Max Muster")).toBeVisible()
    await expect(page.getByText("Anna Kind")).toBeVisible()
  })

  test("form validation prevents advancing and shows errors", async ({ page }) => {
    await page.goto("/")
    await openGuestSection(page)

    // "Weiter" is always enabled on the guest section (clickable)
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
    await expect(page.getByTestId("person-card").first()).toBeVisible()

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

    // ── Regression (#110): Nutzungsbestimmungen link is inlined in the
    // checkbox label. Clicking the link does not toggle the checkbox.
    const termsLink = page.getByRole("link", { name: "Nutzungsbestimmungen" })
    await expect(termsLink).toHaveAttribute(
      "href",
      "https://werkstattwaedi.ch/nutzungsbestimmungen",
    )
    await expect(termsLink).toHaveAttribute("target", "_blank")
    const termsCheckbox = page.locator("#terms-accept")
    await expect(termsCheckbox).not.toBeChecked()
    await termsLink.evaluate((a) =>
      a.addEventListener("click", (e) => e.preventDefault()),
    )
    await termsLink.click()
    await expect(termsCheckbox).not.toBeChecked()

    // Accept terms — now Weiter advances
    await page.locator("#terms-accept").click()
    await page.getByRole("button", { name: "Weiter" }).click()
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()
  })

  test("step navigation forward and back", async ({ page }) => {
    await page.goto("/")
    await openGuestSection(page)

    // Fill and advance to step 1
    await personField(page, "Vorname").fill("Max")
    await personField(page, "Nachname").fill("Muster")
    await personField(page, "E-Mail").fill("max@test.com")
    await page.locator("#terms-accept").click()
    await page.getByRole("button", { name: "Weiter" }).click()

    // Step 1 visible
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()

    // Advance to step 2
    await page.getByRole("button", { name: "Zum Checkout" }).click()
    await expect(page.getByText("Dein Besuch")).toBeVisible()

    // Go back to step 1
    await page.getByRole("button", { name: "Zurück" }).click()
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()

    // Go back to step 0 — the rehydrated roster keeps the guest section
    // active (no "Deine Angaben" heading for anonymous visitors anymore).
    await page.getByRole("button", { name: "Zurück" }).click()
    await expect(page.getByTestId("person-card").first()).toBeVisible()
  })

  // Regression for issue #151: anonymous users now sign in eagerly after
  // step 1, write items straight to Firestore (no more `state.localItems`
  // in-memory branch). This locks in the new storage contract — anything
  // an anonymous user adds to their cart shows up in `checkouts/{id}`
  // and `checkouts/{id}/items/{itemId}` immediately, before submit.
  test("anonymous flow writes items to Firestore (no in-memory cart)", async ({
    page,
  }) => {
    await page.goto("/")
    await openGuestSection(page)

    // Step 0 — fill the form and advance. This now signs the visitor
    // into Firebase Anonymous Auth.
    await personField(page, "Vorname").fill("Refresh")
    await personField(page, "Nachname").fill("Tester")
    await personField(page, "E-Mail").fill("refresh@test.com")
    await page.locator("#terms-accept").click()
    await page.getByRole("button", { name: "Weiter" }).click()

    await expect(page.getByText("Werkstätten wählen")).toBeVisible()

    // Add a Holz catalog item via the MaterialPicker.
    await page.getByRole("button", { name: "Holz", exact: true }).click()
    const holzSection = page.getByTestId("workshop-block-holz")
    await holzSection
      .getByRole("button", { name: "Material hinzufügen" })
      .click()
    await expect(page.getByText("Schleifpapier")).toBeVisible()
    await page.getByText("Schleifpapier").click()
    const qtyInput = page.locator('label:has-text("Anzahl")').locator("..").locator("input")
    await qtyInput.fill("1")
    await page.getByRole("button", { name: "Hinzufügen", exact: true }).click()
    await page.getByRole("button", { name: "Schliessen" }).click()

    // Wait for the Firestore write to land. With the legacy
    // `state.localItems` branch this poll would never see a doc — items
    // were kept in React state only and never persisted before submit.
    await expect
      .poll(
        async () => {
          const checkouts = await getCheckoutDocs()
          // Anonymous flow: userId is null on the doc.
          const co = checkouts.find((c) => c.userId == null)
          if (!co) return 0
          const items = await getCheckoutItems(co.id)
          return items.length
        },
        { timeout: 10_000 },
      )
      .toBe(1)

    // The checkout is open (not closed) — submit hasn't happened yet.
    const checkouts = await getCheckoutDocs()
    const co = checkouts.find((c) => c.userId == null)!
    expect(co.status).toBe("open")
  })
})
