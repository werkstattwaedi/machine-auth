// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Issue #729: one full-width header with the menu top right replaced the
// sidebar footer (avatar row, sign-out, truncated "Version … · Problem
// melden"). Locks the open menu on desktop (dropdown) and on a phone (the
// right-hand sheet that also carries the navigation).

import { test, expect } from "@playwright/test"
import { clearCollections, signInWithEmailCode } from "./helpers"
import { ADMIN_EMAIL } from "./global-setup"

test.describe("Header menu visual regression", () => {
  test.beforeEach(async () => {
    await clearCollections("loginCodes")
  })

  test("desktop dropdown", async ({ page }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.waitForURL((url) => url.pathname.startsWith("/users"))
    await expect(
      page.getByRole("link", { name: "Anna Architektin", exact: true }),
    ).toBeVisible()
    // The sign-in toast would otherwise sit in the capture for a while.
    await expect(page.getByText("Erfolgreich angemeldet")).toHaveCount(0, {
      timeout: 10_000,
    })

    await page.getByRole("button", { name: "Konto-Menü" }).click()
    const menu = page.getByRole("menu")
    await expect(menu).toContainText(ADMIN_EMAIL)
    await expect(page.getByRole("menuitem", { name: "Abmelden" })).toBeVisible()

    await expect(page).toHaveScreenshot("header-menu-desktop.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    })
  })

  test("mobile sheet", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.waitForURL((url) => url.pathname.startsWith("/users"))
    await expect(
      page.getByRole("link", { name: "Anna Architektin", exact: true }),
    ).toBeVisible()
    // The sign-in toast would otherwise sit in the capture for a while.
    await expect(page.getByText("Erfolgreich angemeldet")).toHaveCount(0, {
      timeout: 10_000,
    })

    // One menu top right — no hamburger on the left any more.
    await page.getByRole("button", { name: "Menü" }).click()
    const sheet = page.getByTestId("app-menu-sheet")
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole("link", { name: "Versionen" })).toBeVisible()
    await expect(sheet.getByRole("button", { name: "Abmelden" })).toBeVisible()
    // Let the slide-in finish before the capture.
    await page.waitForTimeout(600)

    await expect(page).toHaveScreenshot("header-menu-mobile.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    })

    // Choosing an entry navigates and closes the sheet.
    await sheet.getByRole("link", { name: "Versionen" }).click()
    await page.waitForURL((url) => url.pathname.startsWith("/versions"))
    await expect(sheet).not.toBeVisible()
  })
})
