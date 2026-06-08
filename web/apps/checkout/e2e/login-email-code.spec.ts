// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { clearCollections, getAdminFirestore, waitForLoginCode } from "./helpers"
import { AUTH_USER_EMAIL } from "./global-setup"

// A completed, seeded account (matching auth uid + accepted terms) so the
// existence check routes to the code-only sign-in stage.
const EXISTING_EMAIL = AUTH_USER_EMAIL
// A fresh email that has no account — routes to the inline sign-up form.
const NEW_EMAIL = "login-flow@werkstattwaedi.ch"

test.describe("Login flow (combined sign-in/sign-up)", () => {
  test.beforeEach(async () => {
    await clearCollections("loginCodes")
    const db = getAdminFirestore()
    const snap = await db.collection("users").where("email", "==", NEW_EMAIL).get()
    if (!snap.empty) {
      const batch = db.batch()
      snap.docs.forEach((d) => batch.delete(d.ref))
      await batch.commit()
    }
  })

  test("email stage → existing account shows code-only sign-in", async ({ page }) => {
    await page.goto("/login")

    await expect(page.getByTestId("login-email-stage")).toBeVisible()
    await expect(page).toHaveScreenshot("login-email-stage.png")

    await page.getByTestId("login-email-input").fill(EXISTING_EMAIL)
    await page.getByTestId("login-email-submit").click()

    // Existing account → code-only stage, no sign-up fields.
    await expect(page.getByTestId("login-code-stage")).toBeVisible()
    await expect(page.getByTestId("signup-firstname")).not.toBeVisible()
    await expect(page).toHaveScreenshot("login-code-stage.png", {
      mask: [page.locator("strong").filter({ hasText: EXISTING_EMAIL })],
    })

    const entry = await waitForLoginCode(EXISTING_EMAIL)
    expect(entry, "debugCode should be present in emulator").toBeTruthy()

    await page.getByTestId("login-code-input").fill(entry!.code)
    await page.getByTestId("login-code-submit").click()

    // Completed account → straight into the app (away from /login).
    await page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 10_000,
    })
  })

  test("new email branches to the inline sign-up form", async ({ page }) => {
    await page.goto("/login")
    await page.getByTestId("login-email-input").fill(NEW_EMAIL)
    await page.getByTestId("login-email-submit").click()

    await expect(page.getByTestId("login-signup-stage")).toBeVisible({
      timeout: 5_000,
    })
    await expect(page.getByTestId("login-code-stage")).not.toBeVisible()
    await expect(page.getByTestId("signup-firstname")).toBeVisible()
  })

  test("wrong code shows error without burning the doc", async ({ page }) => {
    await page.goto("/login")
    await page.getByTestId("login-email-input").fill(EXISTING_EMAIL)
    await page.getByTestId("login-email-submit").click()
    await expect(page.getByTestId("login-code-stage")).toBeVisible()

    // Wait for the code to exist before submitting a bogus one, otherwise the
    // verify call fails with "no active code" instead of "wrong code".
    await waitForLoginCode(EXISTING_EMAIL)

    await page.getByTestId("login-code-input").fill("000000")
    await page.getByTestId("login-code-submit").click()
    await expect(page.getByTestId("login-code-error")).toBeVisible()
    await expect(page).toHaveScreenshot("login-code-error.png", {
      mask: [page.locator("strong").filter({ hasText: EXISTING_EMAIL })],
    })
  })

  test("magic link signs an existing user straight in", async ({ page }) => {
    await page.goto("/login")
    await page.getByTestId("login-email-input").fill(EXISTING_EMAIL)
    await page.getByTestId("login-email-submit").click()

    const entry = await waitForLoginCode(EXISTING_EMAIL)
    expect(entry).toBeTruthy()

    await page.goto(`/login/verify?token=${encodeURIComponent(entry!.docId)}`)
    await page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 10_000,
    })
  })
})
