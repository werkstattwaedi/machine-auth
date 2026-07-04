// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kiosk email-code sign-in (ADR-0022): a registered user without their badge
 * signs in on the kiosk check-in screen with the 6-digit email code, which
 * mints the same lightweight actsAs session a badge tap would. Since the
 * sign-in redesign the flow lives in the check-in "Mit Konto anmelden"
 * section: identifier field inline, code entry in a modal dialog. The kiosk
 * UI works browser-side without window.bridge; the emulator skips the bearer.
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

    await page.getByTestId("checkin-identifier").fill(AUTH_USER_EMAIL)
    await page.getByTestId("checkin-identifier-submit").click()

    const entry = await waitForLoginCode(AUTH_USER_EMAIL)
    expect(entry, "debugCode should be present in emulator").toBeTruthy()

    await expect(page.getByTestId("checkin-code-dialog")).toBeVisible()
    await page.getByTestId("checkin-code-input").fill(entry!.code)
    await page.getByTestId("checkin-code-submit").click()

    // The identified session pre-fills the primary person: the identity
    // strip replaces the account section (switcher, dialog and badge
    // affordance all unmount).
    await expect(page.getByTestId("identity-strip")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByTestId("identity-strip")).toContainText("E2E")
    await expect(page.getByTestId("checkin-seg-account")).not.toBeVisible()
  })

  test("unknown email shows the register-on-your-own-device notice, no code sent", async ({
    page,
  }) => {
    await page.goto("/checkin?kiosk")

    await page
      .getByTestId("checkin-identifier")
      .fill("nobody-kiosk@werkstattwaedi.ch")
    await page.getByTestId("checkin-identifier-submit").click()

    await expect(page.getByTestId("checkin-signin-error")).toContainText(
      "existiert noch kein Konto"
    )
    // No code dialog appeared — the kiosk has no sign-up.
    await expect(page.getByTestId("checkin-code-dialog")).not.toBeVisible()
  })

  test("wrong code shows the inline German error", async ({ page }) => {
    await page.goto("/checkin?kiosk")

    await page.getByTestId("checkin-identifier").fill(AUTH_USER_EMAIL)
    await page.getByTestId("checkin-identifier-submit").click()

    // Wait for the real code to exist so verify hits "wrong code", not
    // "no active code".
    await waitForLoginCode(AUTH_USER_EMAIL)

    await page.getByTestId("checkin-code-input").fill("000000")
    await page.getByTestId("checkin-code-submit").click()

    await expect(page.getByTestId("checkin-code-error")).toContainText(
      "Code falsch."
    )
  })

  test("Abbrechen returns to the idle state with the identifier cleared", async ({
    page,
  }) => {
    await page.goto("/checkin?kiosk")

    await page.getByTestId("checkin-identifier").fill(AUTH_USER_EMAIL)
    await page.getByTestId("checkin-identifier-submit").click()
    await expect(page.getByTestId("checkin-code-dialog")).toBeVisible()

    await page.getByTestId("checkin-code-cancel").click()
    await expect(page.getByTestId("checkin-code-dialog")).not.toBeVisible()
    await expect(page.getByTestId("checkin-identifier")).toHaveValue("")
    // The switcher is back in its idle state.
    await expect(page.getByTestId("checkin-seg-account")).toBeVisible()
  })
})
