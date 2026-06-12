// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import {
  clearCheckoutsDeep,
  clearCollections,
  getBillDocs,
  getCheckoutDocs,
  seedOpenCheckoutWithMembership,
  waitForLoginCode,
} from "./helpers"
import { AUTH_USER_EMAIL, AUTH_USER_ID } from "./global-setup"

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

    // Click the single combined login link in the identity hint.
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

    // Navigate to the checkout page — the logged-in user's identity renders
    // as a compact strip (full name), not an editable card. (The header also
    // shows the name, so scope to the strip to avoid a strict-mode match.)
    await page.goto("/")
    await expect(page.getByTestId("identity-strip")).toContainText(
      "E2E Testuser",
      { timeout: 10_000 },
    )

    // "Weiter" should be enabled (pre-filled user)
    await expect(
      page.getByRole("button", { name: "Weiter" }),
    ).toBeEnabled({ timeout: 5000 })

    // No terms checkbox for authenticated users
    await expect(page.locator("#terms-accept")).not.toBeVisible()

    // ── Proceed through checkout ──
    await page.getByRole("button", { name: "Weiter" }).click()
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()

    await page.getByRole("button", { name: "Zum Checkout" }).click()
    await expect(page.getByText("Dein Besuch")).toBeVisible()

    // Expand the collapsible Nutzungsgebühren section to verify person is listed.
    // The display name also renders in the page header ("Nutzungsverlauf öffnen"
    // link), so scope the assertion to the section detail to avoid strict-mode
    // dupes.
    await page.getByRole("button", { name: /Nutzungsgebühren/ }).click()
    await expect(
      page.locator("#nutzung-detail").getByText("E2E Testuser", { exact: true }),
    ).toBeVisible()

    // Submit
    await page.getByRole("button", { name: "Weiter zum Bezahlen" }).click()

    // ── Payment result (Step 4) ──
    await expect(page.getByText("Zu bezahlen")).toBeVisible({
      timeout: 10_000,
    })

    // ── Commit the chosen payment method (Rechnung is the default tab) ──
    await page
      .getByRole("button", {
        name: /Ich zahle die QR-Rechnung & Werkstatt verlassen/,
      })
      .click()

    // ── Verify Firestore: checkout has userId as DocumentReference,
    //    and the linked bill carries the ack stamp. ──
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

    // userId should be a DocumentReference (has path property)
    const userIdRef = checkout.userId as { path: string }
    expect(userIdRef.path).toContain("users/")
  })

  // Regression for #361: the wizard header avatar/name used to deep-link to
  // /account/profile; it should land on the more useful past-usage page.
  test("wizard header avatar navigates to past usage, not profile", async ({
    page,
  }) => {
    // ── Sign in via email + code ──
    await page.goto("/login")
    await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
    await page.getByTestId("login-email-submit").click()
    await expect(page.getByTestId("login-code-stage")).toBeVisible({
      timeout: 5000,
    })
    const entry = await waitForLoginCode(AUTH_USER_EMAIL)
    expect(entry).toBeTruthy()
    await page.getByTestId("login-code-input").fill(entry!.code)
    await page.getByTestId("login-code-submit").click()
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 10_000,
    })

    // ── Land on the wizard header (checkin) where the identity link renders ──
    await page.goto("/checkin")
    const headerLink = page.getByRole("link", { name: "Nutzungsverlauf öffnen" })
    await expect(headerLink).toBeVisible({ timeout: 10_000 })

    // The link must target the past-usage route, not the profile page.
    await expect(headerLink).toHaveAttribute("href", "/account/usage")

    // Clicking it lands on the usage page.
    await headerLink.click()
    await page.waitForURL("**/account/usage", { timeout: 10_000 })
    expect(new URL(page.url()).pathname).toBe("/account/usage")
  })

  // Regression for #387: visiting the root dispatcher while the signed-in
  // user already has an open (today) checkout must land on /visit — never
  // /checkin. The bug was a one-render stale-loading race in useCollection:
  // the open-checkout query read as "loaded, empty" on the render where the
  // user ref first became non-null, so the dispatcher bounced to /checkin.
  test("root dispatcher routes to /visit when an open checkout exists", async ({
    page,
  }) => {
    // ── Sign in via email + code ──
    await page.goto("/login")
    await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
    await page.getByTestId("login-email-submit").click()
    await expect(page.getByTestId("login-code-stage")).toBeVisible({
      timeout: 5000,
    })
    const entry = await waitForLoginCode(AUTH_USER_EMAIL)
    expect(entry).toBeTruthy()
    await page.getByTestId("login-code-input").fill(entry!.code)
    await page.getByTestId("login-code-submit").click()
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 10_000,
    })

    // Seed an open, same-day checkout owned by the signed-in user.
    await seedOpenCheckoutWithMembership(AUTH_USER_ID)

    // Hit the root dispatcher. It must settle on /visit, not /checkin.
    await page.goto("/")
    await page.waitForURL("**/visit", { timeout: 10_000 })
    expect(new URL(page.url()).pathname).toBe("/visit")

    await clearCheckoutsDeep()
  })
})
