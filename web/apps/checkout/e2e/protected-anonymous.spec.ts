// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Regression for issue #179: an eager-anon Firebase principal (created
// mid-wizard for the no-account checkout flow) must NOT be allowed to
// reach member-area routes like /account/profile or
// /account/complete-profile. The route guards in
// `authenticated-layout.tsx` and `_authonly.tsx` should redirect to
// /login with ?redirect=<pathname> and never render the protected
// chrome. (Note: /visit is no longer member-only — after the wizard
// URL-routes refactor it's part of the public checkout flow.)

import { test, expect, type Page, type Locator } from "@playwright/test"
import { clearCollections, openGuestSection } from "./helpers"

/** Locate an input field by its preceding label text within a person card */
function personField(page: Page, label: string, nth = 0): Locator {
  return page
    .locator(`label:has-text("${label}")`)
    .nth(nth)
    .locator("..")
    .locator("input")
}

/**
 * Walk the kiosk wizard far enough to trigger eager anonymous sign-in.
 * After advancing past step 0 the visitor has a Firebase Anonymous
 * principal — exactly the state we need to test member-area gating.
 */
async function signInEagerAnonymous(page: Page) {
  await page.goto("/")
  await openGuestSection(page)

  await personField(page, "Vorname").fill("Anon")
  await personField(page, "Nachname").fill("Visitor")
  await personField(page, "E-Mail").fill("anon@test.com")
  await page.locator("#terms-accept").click()
  await page.getByRole("button", { name: "Weiter" }).click()

  // Step 1 visible → an anonymous principal now exists.
  await expect(page.getByText("Werkstätten wählen")).toBeVisible()
}

test.describe("Protected routes block anonymous principals (#179)", () => {
  test.beforeEach(async () => {
    await clearCollections("checkouts")
  })

  test("anonymous user is redirected away from /account/profile to /login", async ({
    page,
  }) => {
    await signInEagerAnonymous(page)

    await page.goto("/account/profile")

    await page.waitForURL((url) => url.pathname === "/login", {
      timeout: 10_000,
    })
    await expect(page).toHaveURL(/\/login\?.*redirect=%2Faccount%2Fprofile/)
    await expect(page.getByTestId("login-email-stage")).toBeVisible()
  })

  test("anonymous user is redirected away from /account/complete-profile to /login", async ({
    page,
  }) => {
    await signInEagerAnonymous(page)

    await page.goto("/account/complete-profile")

    await page.waitForURL((url) => url.pathname === "/login", {
      timeout: 10_000,
    })
    await expect(page).toHaveURL(/\/login\?.*redirect=%2Faccount%2Fcomplete-profile/)
    await expect(page.getByTestId("login-email-stage")).toBeVisible()
  })
})
