// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { clearCollections, getAuthOobCodes, getCheckoutDocs } from "./helpers"
import { AUTH_USER_EMAIL } from "./global-setup"

test.beforeEach(async () => {
  await clearCollections("checkouts")
})

test.describe("Authenticated checkout", () => {
  test("email link sign-in and checkout with pre-filled person", async ({
    page,
  }) => {
    await page.goto("/checkout")

    // ── Landing: email sign-in form ──
    await expect(page.getByText("Anmelden")).toBeVisible()
    await expect(
      page.getByPlaceholder("deine@email.ch"),
    ).toBeVisible()

    // Enter email and request sign-in link
    await page.getByPlaceholder("deine@email.ch").fill(AUTH_USER_EMAIL)
    await page
      .getByRole("button", { name: "Anmelde-Link senden" })
      .click()

    // Verify "link sent" message
    await expect(
      page.getByText("Anmelde-Link wurde an"),
    ).toBeVisible({ timeout: 5000 })

    // ── Fetch OOB code from Auth emulator ──
    const oobCodes = await getAuthOobCodes()
    const signInCode = oobCodes.find(
      (c) =>
        c.email === AUTH_USER_EMAIL &&
        c.requestType === "EMAIL_SIGNIN",
    )
    expect(signInCode).toBeTruthy()

    // Navigate to the sign-in link (redirects to /login as configured)
    await page.goto(signInCode!.oobLink)

    // Wait for sign-in to complete — the app redirects authenticated users
    // away from /login, so wait for navigation away from the OOB URL
    await page.waitForURL((url) => !url.href.includes("oobCode"), {
      timeout: 10_000,
    })

    // Navigate to checkout
    await page.goto("/checkout")

    // The person card should show pre-filled data (name split into first/last)
    await expect(page.getByText("Testuser")).toBeVisible({
      timeout: 10_000,
    })

    // "Weiter" should be enabled (pre-filled user)
    await expect(
      page.getByRole("button", { name: "Weiter" }),
    ).toBeEnabled({ timeout: 5000 })

    // No terms checkbox for authenticated users
    await expect(page.locator("#terms-accept")).not.toBeVisible()

    // ── Proceed through checkout ──
    await page.getByRole("button", { name: "Weiter" }).click()
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()

    await page.getByRole("button", { name: "Check-Out" }).click()
    await expect(page.getByText("Zusammenfassung")).toBeVisible()

    // Verify person name in summary
    await expect(page.getByText("E2E Testuser", { exact: true })).toBeVisible()

    // Submit
    await page.getByRole("button", { name: "Senden & zur Kasse" }).click()

    // ── Payment result ──
    await expect(page.getByText("Vielen Dank!")).toBeVisible({
      timeout: 10_000,
    })

    // ── Verify Firestore: checkout has userId as DocumentReference ──
    const checkouts = await getCheckoutDocs()
    expect(checkouts.length).toBeGreaterThanOrEqual(1)

    const checkout = checkouts[0] as Record<string, unknown>
    expect(checkout.status).toBe("closed")

    // userId should be a DocumentReference (has path property)
    const userIdRef = checkout.userId as { path: string }
    expect(userIdRef.path).toContain("users/")
  })
})
