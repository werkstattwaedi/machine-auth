// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import {
  clearCollections,
  getAdminFirestore,
  waitForLoginCode,
} from "./helpers"

const EMAIL = "login-flow@werkstattwaedi.ch"

test.describe("Login flow (email code + magic link)", () => {
  test.beforeEach(async () => {
    await clearCollections("loginCodes")
    const db = getAdminFirestore()
    const snap = await db.collection("users").where("email", "==", EMAIL).get()
    if (!snap.empty) {
      const batch = db.batch()
      snap.docs.forEach((d) => batch.delete(d.ref))
      await batch.commit()
    }
  })

  test("email stage → code stage → signed in", async ({ page }) => {
    await page.goto("/login")

    // Stage 1: email entry
    await expect(page.getByTestId("login-email-stage")).toBeVisible()
    await expect(page).toHaveScreenshot("login-email-stage.png")

    await page.getByTestId("login-email-input").fill(EMAIL)
    await page.getByTestId("login-email-submit").click()

    // Stage 2: code entry
    await expect(page.getByTestId("login-code-stage")).toBeVisible()
    // Mask the email that's rendered into the message so the screenshot is
    // stable across different test emails.
    await expect(page).toHaveScreenshot("login-code-stage.png", {
      mask: [page.locator("strong").filter({ hasText: EMAIL })],
    })

    // Read the code the Functions emulator wrote to Firestore
    const entry = await waitForLoginCode(EMAIL)
    expect(entry, "debugCode should be present in emulator").toBeTruthy()

    await page.getByTestId("login-code-input").fill(entry!.code)
    await page.getByTestId("login-code-submit").click()

    // New users land on /complete-profile; existing users on /visit
    await page.waitForURL(
      (url) =>
        url.pathname.includes("/complete-profile") ||
        url.pathname.includes("/visit"),
      { timeout: 10_000 },
    )
  })

  test("wrong code shows error without burning the doc", async ({ page }) => {
    await page.goto("/login")
    await page.getByTestId("login-email-input").fill(EMAIL)
    await page.getByTestId("login-email-submit").click()
    await expect(page.getByTestId("login-code-stage")).toBeVisible()

    // Wait for the code to actually exist before submitting a bogus one —
    // otherwise the verify call would fail with "no active code" instead of
    // "wrong code".
    await waitForLoginCode(EMAIL)

    await page.getByTestId("login-code-input").fill("000000")
    await page.getByTestId("login-code-submit").click()
    await expect(page.getByTestId("login-code-error")).toBeVisible()
    await expect(page).toHaveScreenshot("login-code-error.png", {
      mask: [page.locator("strong").filter({ hasText: EMAIL })],
    })
  })

  test("magic link signs the user in", async ({ page }) => {
    await page.goto("/login")
    await page.getByTestId("login-email-input").fill(EMAIL)
    await page.getByTestId("login-email-submit").click()

    const entry = await waitForLoginCode(EMAIL)
    expect(entry).toBeTruthy()

    await page.goto(`/login/verify?token=${encodeURIComponent(entry!.docId)}`)
    await page.waitForURL(
      (url) =>
        url.pathname.includes("/complete-profile") ||
        url.pathname.includes("/visit"),
      { timeout: 10_000 },
    )
  })
})
