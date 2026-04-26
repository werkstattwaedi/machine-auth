// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { clearCollections, signInWithEmailCode } from "./helpers"
import { ADMIN_EMAIL, GRANT_TARGET_USER_ID } from "./global-setup"

test.describe("Admin layout visual regression", () => {
  test.beforeEach(async () => {
    await clearCollections("loginCodes")
  })

  test("user list page", async ({ page }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.waitForURL((url) => url.pathname.startsWith("/users"))
    await expect(
      page.getByRole("link", { name: "Anna Architektin" }),
    ).toBeVisible()

    // Mask timestamps if they ever appear in this view (none today, but the
    // mask is cheap and prevents surprise drift if a column is added later).
    await expect(page).toHaveScreenshot("users-list.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    })
  })

  test("user detail page", async ({ page }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/users/${GRANT_TARGET_USER_ID}`)
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible()
    // The "Nutzungsbestimmungen akzeptiert am ..." line carries a serverTimestamp,
    // so mask it for stable snapshots.
    const acceptedAt = page.locator("text=/Nutzungsbestimmungen akzeptiert am/")

    await expect(page).toHaveScreenshot("user-detail.png", {
      fullPage: false,
      mask: [acceptedAt],
      maxDiffPixelRatio: 0.01,
    })
  })
})
