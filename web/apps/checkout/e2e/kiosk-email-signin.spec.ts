// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kiosk email-code sign-in (ADR-0022): a registered user without their badge
 * signs in on the kiosk check-in screen with the 6-digit email code, which
 * mints the same lightweight actsAs session a badge tap would. The kiosk UI
 * works browser-side without window.bridge; the emulator skips the bearer.
 */

import { test, expect } from "@playwright/test"
import { clearCollections, waitForLoginCode } from "./helpers"
import { AUTH_USER_EMAIL } from "./global-setup"

test.describe("Kiosk email-code sign-in", () => {
  test.beforeEach(async () => {
    // The 60s per-email resend throttle would trip back-to-back tests.
    await clearCollections("loginCodes")
  })

  test("signs in a completed account and identifies the visitor", async ({
    page,
  }) => {
    await page.goto("/checkin?kiosk")

    await page.getByTestId("kiosk-signin-open").click()
    await page.getByTestId("kiosk-signin-email").fill(AUTH_USER_EMAIL)
    await page.getByTestId("kiosk-signin-email-submit").click()

    const entry = await waitForLoginCode(AUTH_USER_EMAIL)
    expect(entry, "debugCode should be present in emulator").toBeTruthy()

    await page.getByTestId("kiosk-signin-code").fill(entry!.code)
    await page.getByTestId("kiosk-signin-code-submit").click()

    // The identified session pre-fills the primary person: the identity
    // strip replaces the editable card and the badge affordance unmounts.
    await expect(page.getByTestId("identity-strip")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByTestId("identity-strip")).toContainText("E2E")
    await expect(page.getByTestId("kiosk-signin-open")).not.toBeVisible()
  })

  test("unknown email shows the register-on-your-own-device notice, no code sent", async ({
    page,
  }) => {
    await page.goto("/checkin?kiosk")

    await page.getByTestId("kiosk-signin-open").click()
    await page
      .getByTestId("kiosk-signin-email")
      .fill("nobody-kiosk@werkstattwaedi.ch")
    await page.getByTestId("kiosk-signin-email-submit").click()

    await expect(page.getByTestId("kiosk-signin-error")).toContainText(
      "existiert noch kein Konto"
    )
    // Still on the email stage — no code input appeared.
    await expect(page.getByTestId("kiosk-signin-code")).not.toBeVisible()
  })

  test("wrong code shows the inline German error", async ({ page }) => {
    await page.goto("/checkin?kiosk")

    await page.getByTestId("kiosk-signin-open").click()
    await page.getByTestId("kiosk-signin-email").fill(AUTH_USER_EMAIL)
    await page.getByTestId("kiosk-signin-email-submit").click()

    // Wait for the real code to exist so verify hits "wrong code", not
    // "no active code".
    await waitForLoginCode(AUTH_USER_EMAIL)

    await page.getByTestId("kiosk-signin-code").fill("000000")
    await page.getByTestId("kiosk-signin-code-submit").click()

    await expect(page.getByTestId("kiosk-signin-error")).toContainText(
      "Code falsch."
    )
  })
})
