// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect, type Page } from "@playwright/test"
import {
  clearCollections,
  seedFamilyInvite,
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
  await page.goto("/account/membership")
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
        // Adult co-member with a login → "Login" badge.
        { firstName: "Lukas", lastName: "Müller" },
        // Login-less child → "Kein Login · von dir verwaltet" + "Kind" badge.
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
    await expect(page.getByText("Login", { exact: true })).toBeVisible()
    await expect(page.getByText("Kein Login · von dir verwaltet")).toBeVisible()
    // "ausstehend" also appears in the "… · 1 ausstehend" count; pin to the badge.
    await expect(page.getByText("Ausstehend", { exact: true })).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Mitglied hinzufügen" }),
    ).toBeVisible()
    await expect(page).toHaveScreenshot("membership-active-family-owner.png")
  })

  test("active family — add member: no-login form", async ({ page }) => {
    await signIn(page)
    const uid = process.env.E2E_AUTH_USER_UID!
    await seedMembershipState(uid, {
      kind: "active-family-owner",
      coMembers: [{ firstName: "Lukas", lastName: "Müller" }],
    })
    await gotoMembership(page)
    await page.getByRole("button", { name: "Mitglied hinzufügen" }).click()
    await expect(
      page.getByRole("heading", { name: "Wie möchtest du hinzufügen?" }),
    ).toBeVisible()
    await page.getByRole("button", { name: /Ohne Login/ }).click()
    await expect(
      page.getByRole("heading", { name: "Mitglied ohne Login" }),
    ).toBeVisible()
    // The Vorname input is autoFocus'd, which scrolls it into view. On the
    // taller owner view (issue #323 added the auto-renewal block) that scroll
    // races the viewport screenshot; anchor at the top so the captured frame
    // is deterministic.
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(page).toHaveScreenshot(
      "membership-active-family-owner-no-login-form.png",
    )
  })

  test("active family — non-owner sees roster and can leave", async ({ page }) => {
    await signIn(page)
    const uid = process.env.E2E_AUTH_USER_UID!
    await seedMembershipState(uid, { kind: "active-family-member" })
    await gotoMembership(page)
    // Non-owners now see the roster card …
    await expect(page.getByRole("heading", { name: "Familie" })).toBeVisible()
    // … with a self-leave action, but no owner-only add control.
    await expect(
      page.getByRole("button", { name: "Verlassen" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Mitglied hinzufügen" }),
    ).toHaveCount(0)
    await expect(page).toHaveScreenshot("membership-active-family-member.png")
  })

  test("pending invite — shown on the membership page, can join", async ({
    page,
  }) => {
    await signIn(page)
    const uid = process.env.E2E_AUTH_USER_UID!
    // No membership for the auth user; an invite is addressed to their email.
    await seedMembershipState(uid, { kind: "none" })
    await seedFamilyInvite(AUTH_USER_EMAIL)
    await gotoMembership(page)
    await expect(page.getByText(/Du wurdest zur/)).toBeVisible({
      timeout: 10_000,
    })
    await page.getByRole("button", { name: "Beitreten" }).click()
    // Joining lands them in an active family membership.
    await expect(page.getByText("Aktiv", { exact: true })).toBeVisible({
      timeout: 10_000,
    })
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
