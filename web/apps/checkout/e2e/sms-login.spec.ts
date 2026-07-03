// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * SMS login codes via Firebase phone auth (ADR-0031). The check-in
 * identifier field auto-detects a phone number (smsEnabled via .env.test),
 * looks up the account by the AUTH-LINKED number (verified self-service),
 * sends the code through the Auth emulator, and:
 *   - own device: the confirmed code IS the persistent login,
 *   - kiosk: the phone session is exchanged for the ephemeral actsAs
 *     session (exchangeKioskSession), like a badge tap.
 */

import { test, expect } from "@playwright/test"
import { clearCollections, getAdminAuth, waitForSmsCode, waitForLoginCode } from "./helpers"
import { AUTH_USER_EMAIL } from "./global-setup"

const SMS_PHONE = "+41791234599"

// Link the phone to the seeded auth user once — the verified-self-service
// state the flows depend on. updateUser is idempotent for the same value.
test.beforeAll(async () => {
  const auth = await getAdminAuth()
  const user = await auth.getUserByEmail(AUTH_USER_EMAIL)
  await auth.updateUser(user.uid, { phoneNumber: SMS_PHONE })
})

test.describe("SMS login on the check-in page", () => {
  test("unverified number shows the profile hint, no dialog", async ({
    page,
  }) => {
    await page.goto("/checkin")

    await page.getByTestId("checkin-identifier").fill("079 999 88 77")
    await page.getByTestId("checkin-identifier-submit").click()

    await expect(page.getByTestId("checkin-signin-error")).toContainText(
      "kein Konto hinterlegt",
    )
    await expect(page.getByTestId("checkin-code-dialog")).not.toBeVisible()
  })

  test("own device: verified number signs in with the SMS code", async ({
    page,
  }) => {
    await page.goto("/checkin")

    // National format — normalization to E.164 happens client-side.
    await page.getByTestId("checkin-identifier").fill("079 123 45 99")
    await page.getByTestId("checkin-identifier-submit").click()

    await expect(page.getByTestId("checkin-code-dialog")).toBeVisible({
      timeout: 10_000,
    })
    // The dialog subtitle names the normalized number.
    await expect(page.getByTestId("checkin-code-dialog")).toContainText(
      SMS_PHONE,
    )

    const code = await waitForSmsCode(SMS_PHONE)
    expect(code, "Auth emulator should expose the verification code").toBeTruthy()

    await page.getByTestId("checkin-code-input").fill(code!)
    await page.getByTestId("checkin-code-submit").click()

    // Signed in in place: the identity strip replaces the switcher.
    await expect(page.getByTestId("identity-strip")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByTestId("identity-strip")).toContainText("E2E")
  })

  test("kiosk: verified number gets the ephemeral kiosk session", async ({
    page,
  }) => {
    await page.goto("/checkin?kiosk")

    await page.getByTestId("checkin-identifier").fill(SMS_PHONE)
    await page.getByTestId("checkin-identifier-submit").click()

    await expect(page.getByTestId("checkin-code-dialog")).toBeVisible({
      timeout: 10_000,
    })
    const code = await waitForSmsCode(SMS_PHONE)
    expect(code).toBeTruthy()

    await page.getByTestId("checkin-code-input").fill(code!)
    await page.getByTestId("checkin-code-submit").click()

    await expect(page.getByTestId("identity-strip")).toBeVisible({
      timeout: 10_000,
    })
    // The kiosk footer offers "Besuch starten" — proof the wizard sees an
    // identified (actsAs) session, not an anonymous one.
    await expect(
      page.getByRole("button", { name: /Besuch starten/ }),
    ).toBeVisible()
  })

  test("wrong SMS code shows the inline German error", async ({ page }) => {
    await page.goto("/checkin")

    await page.getByTestId("checkin-identifier").fill(SMS_PHONE)
    await page.getByTestId("checkin-identifier-submit").click()
    await expect(page.getByTestId("checkin-code-dialog")).toBeVisible({
      timeout: 10_000,
    })
    await waitForSmsCode(SMS_PHONE)

    await page.getByTestId("checkin-code-input").fill("000000")
    await page.getByTestId("checkin-code-submit").click()

    await expect(page.getByTestId("checkin-code-error")).toContainText(
      "Code falsch.",
    )
  })

  // Runs LAST in this file: it relinks the auth user's phone to a new
  // number (updatePhoneNumber path). The next project's beforeAll restores
  // SMS_PHONE.
  test("profile: saving + verifying a new number enables it for SMS login", async ({
    page,
  }) => {
    const NEW_PHONE = "+41791234588"
    await clearCollections("loginCodes")

    // Sign in via the /login code flow (recent login also satisfies
    // updatePhoneNumber's security requirement).
    await page.goto("/login")
    await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
    await page.getByTestId("login-email-submit").click()
    await expect(page.getByTestId("login-code-stage")).toBeVisible({
      timeout: 5_000,
    })
    const loginCode = await waitForLoginCode(AUTH_USER_EMAIL)
    await page.getByTestId("login-code-input").fill(loginCode!.code)
    await page.getByTestId("login-code-submit").click()
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 10_000,
    })

    await page.goto("/account/profile")
    // Wait for the userDoc-driven form hydration (reset) before typing —
    // filling earlier gets wiped by the reset and leaves the form pristine.
    await expect(
      page.locator('input[autocomplete="given-name"]'),
    ).not.toHaveValue("", { timeout: 10_000 })
    const phoneField = page.locator('input[type="tel"]')
    await phoneField.fill("079 123 45 88")
    await page.getByRole("button", { name: "Speichern" }).click()

    // Saved: the userDoc round-trip resets the form (field shows the
    // normalized E.164) and the verification affordance becomes clickable
    // ("Zuerst speichern" gating lifts). "Gespeichert." flashes only until
    // that reset, so don't assert on it.
    await expect(phoneField).toHaveValue(NEW_PHONE, { timeout: 10_000 })
    await expect(page.getByTestId("phone-verify-start")).toBeEnabled()
    await page.getByTestId("phone-verify-start").click()
    await expect(page.getByTestId("checkin-code-dialog")).toBeVisible({
      timeout: 10_000,
    })
    const smsCode = await waitForSmsCode(NEW_PHONE)
    expect(smsCode).toBeTruthy()
    await page.getByTestId("checkin-code-input").fill(smsCode!)
    await page.getByTestId("checkin-code-submit").click()

    await expect(
      page.getByText("Bestätigt — du kannst dich per SMS-Code anmelden."),
    ).toBeVisible({ timeout: 10_000 })

    // The freshly verified number is accepted by the auth-linked lookup.
    const auth = await getAdminAuth()
    const user = await auth.getUserByEmail(AUTH_USER_EMAIL)
    expect(user.phoneNumber).toBe(NEW_PHONE)
  })
})
