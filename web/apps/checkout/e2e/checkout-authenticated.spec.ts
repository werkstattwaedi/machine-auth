// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { clearCollections, waitForOobCode, getCheckoutDocs } from "./helpers"
import { AUTH_USER_EMAIL } from "./global-setup"

test.beforeEach(async () => {
  await clearCollections("checkouts")
})

test.describe("Authenticated checkout", () => {
  test("email link sign-in and checkout with pre-filled person", async ({
    page,
  }) => {
    await page.goto("/")

    // ── Checkout page shows login hint ──
    await expect(
      page.getByText("Bereits registriert oder Konto erstellen?"),
    ).toBeVisible({
      timeout: 10_000,
    })

    // Click "Anmelden" (the login hint now renders both Anmelden + Registrieren
    // links, so pin by href).
    await page.locator('a[href="/login?redirect=/"]').click()
    await page.waitForURL("**/login**")

    // ── Login page: email sign-in form ──
    await page.getByPlaceholder("deine@email.ch").fill(AUTH_USER_EMAIL)
    await page
      .getByRole("button", { name: "Anmelde-Link senden" })
      .click()

    // Verify "link sent" message
    await expect(
      page.getByText("Anmelde-Link wurde an"),
    ).toBeVisible({ timeout: 5000 })

    // ── Fetch OOB code from Auth emulator ──
    const signInCode = await waitForOobCode(
      (c) => c.email === AUTH_USER_EMAIL && c.requestType === "EMAIL_SIGNIN",
    )
    expect(signInCode).toBeTruthy()

    // Navigate to the sign-in link (redirects to /login which completes the
    // sign-in and then navigates to the authenticated landing page)
    await page.goto(signInCode!.oobLink)

    // Wait for post-login landing — /visit is the default for a signed-in
    // user with a complete profile. Waiting for just !oobCode races with the
    // /login → /visit navigation.
    await page.waitForURL((url) => url.pathname === "/visit", {
      timeout: 10_000,
    })

    // Navigate to the checkout page — the logged-in user sees a pre-filled
    // person card (read-only paragraph with last name).
    await page.goto("/")
    await expect(page.getByText("Testuser", { exact: true })).toBeVisible({
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

    // Expand the collapsible Nutzungsgebühren section to verify person is listed
    await page.getByRole("button", { name: /Nutzungsgebühren/ }).click()
    await expect(page.getByText("E2E Testuser", { exact: true })).toBeVisible()

    // Submit
    await page.getByRole("button", { name: "Senden & zur Kasse" }).click()

    // ── Payment result ──
    await expect(page.getByText("Zu bezahlen")).toBeVisible({
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
