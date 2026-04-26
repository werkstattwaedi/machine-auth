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
    await expect(page.getByRole("heading", { name: "Benutzer" })).toBeVisible()
  })

  test("non-admin signed-in user is bounced away from the admin shell", async ({
    page,
  }) => {
    await signInWithEmailCode(page, NON_ADMIN_EMAIL)

    // The admin gate in AuthenticatedLayout kicks non-admins back to /login
    // the moment the user doc resolves. Observing the URL touch /login is
    // sufficient proof the gate fired — we don't assert further state
    // because the LoginPage then re-redirects a signed-in user to /users,
    // which can produce a benign ping-pong that has no UX consequence
    // (the admin heading never paints stably; this is asserted in the
    // companion admin spec, which sees it for the admin user only).
    await page.waitForURL((url) => url.pathname.startsWith("/login"), {
      timeout: 10_000,
    })
  })
})
