// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { clearCollections, signInWithEmailCode } from "./helpers"
import { ADMIN_EMAIL, GRANT_TARGET_USER_ID } from "./global-setup"

test.describe("Personen visual regression", () => {
  test.beforeEach(async () => {
    await clearCollections("loginCodes")
  })

  test("people list page", async ({ page }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.waitForURL((url) => url.pathname.startsWith("/users"))
    await expect(
      page.getByRole("link", { name: "Anna Architektin", exact: true }),
    ).toBeVisible()

    await expect(page).toHaveScreenshot("users-list.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    })
  })

  test("person page Übersicht", async ({ page }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/users/${GRANT_TARGET_USER_ID}`)
    await expect(page.getByText("Aktiver Besuch läuft")).toBeVisible()
    // Overview cards load from four person-scoped queries; the last-usage
    // card is the slowest, so anchor on its content.
    await expect(page.getByText("Lasercutter · 1h 20m")).toBeVisible()

    await expect(page).toHaveScreenshot("person-overview.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    })
  })

  test("person page Mitgliedschaft (active family)", async ({ page }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/users/${GRANT_TARGET_USER_ID}?tab=membership`)
    await expect(
      page.getByRole("heading", { name: "Familienmitgliedschaft" }),
    ).toBeVisible()
    await expect(page.getByText("Bruno Bastler")).toBeVisible()

    await expect(page).toHaveScreenshot("person-membership.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    })
  })
})
