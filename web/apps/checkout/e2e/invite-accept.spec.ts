// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Receiving end of a family invite: the public acceptance page reachable from
 * the email link without an account. Functional assertions only (no
 * screenshots) — the page has no fixed visual baseline.
 */

import { test, expect } from "@playwright/test"
import { clearCollections, seedFamilyInvite } from "./helpers"

test.describe("Family invite acceptance (receiving end)", () => {
  test.beforeEach(async () => {
    await clearCollections("memberships", "loginCodes")
  })

  test("no account — minimal sign-up joins the family", async ({ page }) => {
    // Unique email so no Auth user / account exists yet → sign-up branch.
    const email = `invitee-${Date.now()}@beispiel.ch`
    const { membershipId, inviteId } = await seedFamilyInvite(email)

    await page.goto(`/account/invite/${membershipId}/${inviteId}`)
    await expect(
      page.getByRole("heading", { name: "Familieneinladung" }),
    ).toBeVisible({ timeout: 10_000 })

    await page.locator("#invite-first").fill("Neu")
    await page.locator("#invite-last").fill("Mitglied")
    await page.locator("#invite-terms").click()
    await page
      .getByRole("button", { name: /Konto erstellen/ })
      .click()

    // Custom-token sign-in lands the new member on the membership page,
    // where they show up as a (non-owner) member of an active family.
    await page.waitForURL(/\/account\/membership/, { timeout: 15_000 })
    await expect(page.getByText("Aktiv", { exact: true })).toBeVisible({
      timeout: 10_000,
    })
    // The joiner is now a (non-owner) member of an active family — the roster
    // card renders for them too.
    await expect(
      page.getByRole("heading", { name: "Familie" }),
    ).toBeVisible()
  })

  test("existing account — page sends the user to login", async ({ page }) => {
    const email = `existing-${Date.now()}@beispiel.ch`
    const { membershipId, inviteId } = await seedFamilyInvite(email, {
      inviteeHasAccount: true,
    })

    await page.goto(`/account/invite/${membershipId}/${inviteId}`)
    await expect(
      page.getByText(/existiert bereits ein Konto/),
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByRole("button", { name: /Anmelden/ }),
    ).toBeVisible()
  })

  test("missing invite — shows a not-found message", async ({ page }) => {
    const { membershipId } = await seedFamilyInvite(`x-${Date.now()}@beispiel.ch`)
    await page.goto(`/account/invite/${membershipId}/does-not-exist`)
    await expect(
      page.getByText(/nicht gefunden|abgelaufen/),
    ).toBeVisible({ timeout: 10_000 })
  })
})
