// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Receiving end of a family invite. These landings are rarely re-exercised
 * manually and silently break, so each auth/account scenario gets its own test
 * that asserts the key elements AND captures a screenshot (Playwright runs both
 * viewports → desktop + mobile baselines per scenario).
 */

import { test, expect, type Page } from "@playwright/test"
import { clearCollections, seedFamilyInvite, waitForLoginCode } from "./helpers"
import { AUTH_USER_EMAIL } from "./global-setup"

async function signIn(page: Page) {
  await clearCollections("loginCodes")
  await page.goto("/login")
  await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
  await page.getByTestId("login-email-submit").click()
  await expect(page.getByTestId("login-code-stage")).toBeVisible({ timeout: 5000 })
  const entry = await waitForLoginCode(AUTH_USER_EMAIL)
  await page.getByTestId("login-code-input").fill(entry!.code)
  await page.getByTestId("login-code-submit").click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 10_000,
  })
}

test.describe("Family invite acceptance landings", () => {
  test.beforeEach(async () => {
    await clearCollections("memberships", "loginCodes")
  })

  test("invite existing + logged in (right account) → membership banner", async ({
    page,
  }) => {
    await signIn(page)
    const { membershipId, inviteId } = await seedFamilyInvite(AUTH_USER_EMAIL)
    await page.goto(`/account/invite/${membershipId}/${inviteId}`)
    // Signed in as the invited address → routed to the membership page banner.
    await page.waitForURL(/\/account\/membership/, { timeout: 10_000 })
    await expect(page.getByText(/Du wurdest zur/)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("button", { name: "Beitreten" })).toBeVisible()
    await expect(page).toHaveScreenshot("invite-existing-loggedin.png")
  })

  test("invite existing + logged out → inline login", async ({ page }) => {
    const { membershipId, inviteId } = await seedFamilyInvite(
      "invitee-existing@beispiel.ch",
      { inviteeHasAccount: true },
    )
    await page.goto(`/account/invite/${membershipId}/${inviteId}`)
    await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.locator("#invite-login-code")).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Anmelden & annehmen" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: /Mit Google anmelden/ }),
    ).toBeVisible()
    await expect(page).toHaveScreenshot("invite-existing-loggedout.png")
  })

  test("invite existing + wrong account → membership error", async ({ page }) => {
    await signIn(page)
    const { membershipId, inviteId } = await seedFamilyInvite(
      "someone-else@beispiel.ch",
    )
    await page.goto(`/account/invite/${membershipId}/${inviteId}`)
    await page.waitForURL(/\/account\/membership\?invite=/, { timeout: 10_000 })
    await expect(page.getByText("Falsches Konto")).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByText(/someone-else@beispiel\.ch/),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Abmelden & Einladung annehmen" }),
    ).toBeVisible()
    await expect(page).toHaveScreenshot("invite-wrong-account.png")
  })

  test("invite new (no account) + logged out → sign-up landing", async ({
    page,
  }) => {
    // Fixed email + NO submit keeps the screenshot stable (a submit would
    // create a real account, flipping the email to the login branch on the
    // second-viewport run). The full join is covered by the next test.
    const { membershipId, inviteId } = await seedFamilyInvite(
      "new-invitee@beispiel.ch",
    )
    await page.goto(`/account/invite/${membershipId}/${inviteId}`)
    await expect(
      page.getByRole("heading", { name: "Konto erstellen" }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Nutzer:in")).toBeVisible()
    await expect(page.getByText(/Du wurdest von/)).toBeVisible()
    await expect(page).toHaveScreenshot("invite-new-account.png")
  })

  test("invite new (no account) → sign-up joins (functional)", async ({
    page,
  }) => {
    // Unique email per run so the created account never leaks into the
    // screenshot test above or across viewports. No screenshot here.
    const email = `invitee-${Date.now()}@beispiel.ch`
    const { membershipId, inviteId } = await seedFamilyInvite(email)
    await page.goto(`/account/invite/${membershipId}/${inviteId}`)
    await page.locator("#signup-firstname").fill("Neu")
    await page.locator("#signup-lastname").fill("Mitglied")
    await page.locator("#signup-terms").click()
    await page
      .getByRole("button", { name: "Konto erstellen & beitreten" })
      .click()
    await page.waitForURL(/\/account\/membership/, { timeout: 15_000 })
    await expect(page.getByText("Aktiv", { exact: true })).toBeVisible({
      timeout: 10_000,
    })
  })
})
