// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { clearCollections, signInWithEmailCode } from "./helpers"
import { ADMIN_EMAIL, NON_ADMIN_EMAIL } from "./global-setup"

test.describe("Admin login flow", () => {
  test.beforeEach(async () => {
    // Reset prior code requests so the per-email rate limit doesn't reject
    // back-to-back specs and so each test reads its own freshly-issued code.
    await clearCollections("loginCodes")
  })

  test("admin signs in and lands on /users", async ({ page }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)

    await page.waitForURL((url) => url.pathname.startsWith("/users"), {
      timeout: 10_000,
    })
    // Page header on the user list.
    await expect(page.getByRole("heading", { name: "Personen" })).toBeVisible()
  })

  test("non-admin signed-in user sees a terminal no-access state, not a redirect loop", async ({
    page,
  }) => {
    await signInWithEmailCode(page, NON_ADMIN_EMAIL)

    // Regression for #558: a signed-in non-admin used to ping-pong between
    // the admin gate and /login forever with no message. The gate now renders
    // a terminal "Kein Admin-Zugriff" state on the protected route instead of
    // bouncing to /login.
    await expect(
      page.getByRole("heading", { name: "Kein Admin-Zugriff" }),
    ).toBeVisible({ timeout: 10_000 })
    // The loop is broken: the URL settles on the protected route, never /login.
    expect(new URL(page.url()).pathname).not.toBe("/login")

    // The stranded user can actually leave via the sign-out affordance.
    await page.getByRole("button", { name: "Abmelden" }).click()
    await page.waitForURL((url) => url.pathname.startsWith("/login"), {
      timeout: 10_000,
    })
  })
})
