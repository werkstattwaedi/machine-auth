// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

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

test.describe("Profile page screenshots", () => {
  test("default — Nutzer:in at top, no example placeholders", async ({ page }) => {
    await signIn(page)
    await page.goto("/account/profile")
    await expect(
      page.getByRole("heading", { name: "Profil" }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveScreenshot("profile-default.png")
  })
})
