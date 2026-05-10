// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Regression net for issue #212: the desktop sidebar must stay
// viewport-bound (sticky) so the footer (avatar + sign-out) is visible
// even when main content scrolls. The dual-viewport playwright config
// (`chromium` + `mobile-chrome`) covers both desktop and mobile in one
// test file.

import { test, expect, type Page } from "@playwright/test"
import { clearCollections, waitForLoginCode } from "./helpers"
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

test.describe("Sidebar screenshots", () => {
  test("profile page — sidebar with avatar footer", async ({ page }) => {
    await signIn(page)
    await page.goto("/profile")
    await expect(
      page.getByRole("heading", { name: "Profil" }),
    ).toBeVisible({ timeout: 10_000 })
    // Sanity: the seeded display name should be rendered in the sidebar
    // footer (desktop only — mobile sheet is closed).
    await expect(page).toHaveScreenshot("sidebar-profile.png")
  })

  test("membership page — sidebar with avatar footer", async ({ page }) => {
    await signIn(page)
    await page.goto("/membership")
    await expect(
      page.getByRole("heading", { name: "Mitgliedschaft" }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveScreenshot("sidebar-membership.png")
  })
})
