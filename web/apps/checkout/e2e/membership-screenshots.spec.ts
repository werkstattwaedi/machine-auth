// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect, type Page } from "@playwright/test"
import {
  clearCollections,
  seedMembershipState,
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

async function gotoMembership(page: Page) {
  await page.goto("/membership")
  await expect(
    page.getByRole("heading", { name: "Mitgliedschaft" }),
  ).toBeVisible({ timeout: 10_000 })
}

test.describe("Membership page screenshots", () => {
  test("no membership — purchase entry", async ({ page }) => {
    await signIn(page)
    const uid = process.env.E2E_AUTH_USER_UID!
    await seedMembershipState(uid, { kind: "none" })
    await gotoMembership(page)
    await expect(page.getByRole("heading", { name: "Mitglied werden" })).toBeVisible()
    await expect(page).toHaveScreenshot("membership-none.png")
  })

  test("active single — gold swash hero", async ({ page }) => {
    await signIn(page)
    const uid = process.env.E2E_AUTH_USER_UID!
    await seedMembershipState(uid, { kind: "active-single" })
    await gotoMembership(page)
    await expect(page.getByText("Aktiv", { exact: true })).toBeVisible()
    await expect(page.getByText("12.05.2027")).toBeVisible()
    await expect(page).toHaveScreenshot("membership-active-single.png")
  })

  test("active family — owner with roster + pending invite", async ({ page }) => {
    await signIn(page)
    const uid = process.env.E2E_AUTH_USER_UID!
    await seedMembershipState(uid, {
      kind: "active-family-owner",
      coMembers: [
        { firstName: "Lukas", lastName: "Müller" },
        { firstName: "Mia", lastName: "Müller", userType: "kind" },
      ],
      pendingInviteEmail: "oma.maier@beispiel.ch",
    })
    await gotoMembership(page)
    await expect(page.getByRole("heading", { name: "Familie" })).toBeVisible()
    // "Inhaber:in" appears twice: once in the muted hero copy and once as
    // the gold badge in the roster. Pin to the badge to avoid strict-mode.
    await expect(
      page.getByRole("list").getByText("Inhaber:in"),
    ).toBeVisible()
    await expect(page.getByText("Ausstehend")).toBeVisible()
    await expect(page).toHaveScreenshot("membership-active-family-owner.png")
  })

  test("active family — owner with kid form expanded", async ({ page }) => {
    await signIn(page)
    const uid = process.env.E2E_AUTH_USER_UID!
    await seedMembershipState(uid, {
      kind: "active-family-owner",
      coMembers: [{ firstName: "Lukas", lastName: "Müller" }],
    })
    await gotoMembership(page)
    await page
      .getByRole("button", { name: "Kindkonto hinzufügen" })
      .click()
    await expect(page.getByText("Kindkonto erstellen")).toBeVisible()
    await expect(page).toHaveScreenshot(
      "membership-active-family-owner-kid-form.png",
    )
  })

  test("active family — non-owner sees status only", async ({ page }) => {
    await signIn(page)
    const uid = process.env.E2E_AUTH_USER_UID!
    await seedMembershipState(uid, { kind: "active-family-member" })
    await gotoMembership(page)
    await expect(page.getByText("Familie", { exact: true })).toBeVisible()
    // No "Familie verwalten" or roster card for non-owners.
    await expect(
      page.getByRole("heading", { name: "Familie" }),
    ).toHaveCount(0)
    await expect(page).toHaveScreenshot("membership-active-family-member.png")
  })

  test("expired — warn note + Erneuern", async ({ page }) => {
    await signIn(page)
    const uid = process.env.E2E_AUTH_USER_UID!
    await seedMembershipState(uid, { kind: "expired" })
    await gotoMembership(page)
    await expect(page.getByText("Abgelaufen", { exact: true })).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Erneuern" }),
    ).toBeVisible()
    await expect(page).toHaveScreenshot("membership-expired.png")
  })

  test("cancelled — info note, no actions", async ({ page }) => {
    await signIn(page)
    const uid = process.env.E2E_AUTH_USER_UID!
    await seedMembershipState(uid, { kind: "cancelled" })
    await gotoMembership(page)
    await expect(page.getByText("Gekündigt")).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Verlängern" }),
    ).toHaveCount(0)
    await expect(page).toHaveScreenshot("membership-cancelled.png")
  })
})
