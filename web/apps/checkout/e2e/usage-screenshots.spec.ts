// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect, type Page } from "@playwright/test"
import {
  clearCollections,
  seedUsageBills,
  waitForLoginCode,
} from "./helpers"
import { AUTH_USER_EMAIL } from "./global-setup"

/** Sign in as the seeded auth user via the 6-digit code flow. */
async function signIn(page: Page) {
  await clearCollections("loginCodes")
  await page.goto("/login")
  await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
  await page.getByTestId("login-email-submit").click()
  await expect(page.getByTestId("login-code-stage")).toBeVisible({ timeout: 5000 })

  const entry = await waitForLoginCode(AUTH_USER_EMAIL)
  expect(entry).toBeTruthy()
  await page.getByTestId("login-code-input").fill(entry!.code)
  await page.getByTestId("login-code-submit").click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 10_000,
  })
}

test.describe("Usage page screenshots", () => {
  test("invoices tab — paid + open with download icon visible", async ({
    page,
  }) => {
    await signIn(page)
    const uid = process.env.E2E_AUTH_USER_UID!
    await seedUsageBills(uid)

    await page.goto("/account/usage")
    await expect(
      page.getByRole("heading", { name: "Rechnungen" }),
    ).toBeVisible({ timeout: 10_000 })

    // Wait for the page to settle. Text content lives in both the mobile
    // <ul> and the desktop <table> (CSS-hidden, still in DOM), so we
    // anchor on the role-based query — Playwright's accessibility tree
    // filters out the hidden layout, leaving exactly 2 download buttons
    // (one per seeded bill). This is the regression net for issue #215:
    // before the fix the mobile-viewport download button was clipped
    // behind the card's `overflow-hidden`.
    await expect(
      page.getByRole("button", { name: "PDF herunterladen" }),
    ).toHaveCount(2)

    await expect(page).toHaveScreenshot("usage-invoices.png")
  })
})
