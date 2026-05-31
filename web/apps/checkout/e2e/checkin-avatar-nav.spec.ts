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
}

// Regression net for issue #361: the checkin header avatar used to link to
// /profile; it should open the (more useful) past-usage page instead.
test.describe("Checkin header avatar navigation", () => {
  test("avatar click navigates to the past-usage page", async ({ page }) => {
    await signIn(page)

    await page.goto("/")
    const avatarLink = page.getByRole("link", {
      name: "Nutzungsverlauf öffnen",
    })
    await expect(avatarLink).toBeVisible({ timeout: 10_000 })

    await avatarLink.click()

    await page.waitForURL("**/usage", { timeout: 10_000 })
    await expect(
      page.getByRole("heading", { name: "Nutzungsverlauf" }),
    ).toBeVisible({ timeout: 10_000 })
  })
})
