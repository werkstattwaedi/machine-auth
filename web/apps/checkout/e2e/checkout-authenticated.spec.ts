// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { clearCollections, waitForLoginCode, getCheckoutDocs } from "./helpers"
import { AUTH_USER_EMAIL } from "./global-setup"

test.beforeEach(async () => {
  // loginCodes clearing resets the per-email 60 s rate limit between runs.
  await clearCollections("checkouts", "loginCodes")
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

    // ── Login page: email + code flow ──
    await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
    await page.getByTestId("login-email-submit").click()
    await expect(page.getByTestId("login-code-stage")).toBeVisible({
      timeout: 5000,
    })

    // ── Read the code from Firestore (emulator writes debugCode) ──
    const entry = await waitForLoginCode(AUTH_USER_EMAIL)
    expect(entry).toBeTruthy()

    await page.getByTestId("login-code-input").fill(entry!.code)
    await page.getByTestId("login-code-submit").click()

    // Post-login the redirect target is either the stored `redirect=/` (home)
    // or `/visit` (default landing). Accept any non-login URL.
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
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

    await page.getByRole("button", { name: "Checkout", exact: true }).click()
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
