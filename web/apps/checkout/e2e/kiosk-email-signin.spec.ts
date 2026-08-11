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
import { Timestamp } from "firebase-admin/firestore"
import {
  clearCollections,
  getAdminFirestore,
  waitForLoginCode,
} from "./helpers"
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

  test("a new e-mail signs up at the kiosk and is checked in (issue #595)", async ({
    page,
  }) => {
    // Unique address so re-runs within one emulator session stay "new".
    const email = `kiosk-signup-${Date.now()}@werkstattwaedi.ch`
    await page.goto("/checkin?kiosk")

    await page.getByTestId("checkin-identifier").fill(email)
    await page.getByTestId("checkin-identifier-submit").click()

    // The sign-up dialog opens (not the code dialog, not a dead-end error).
    await expect(page.getByTestId("checkin-signup-dialog")).toBeVisible()

    const entry = await waitForLoginCode(email)
    expect(entry, "debugCode should be present in emulator").toBeTruthy()
    await page.getByTestId("signup-code-input").fill(entry!.code)
    await page.getByTestId("signup-firstname").fill("Kiosk")
    await page.getByTestId("signup-lastname").fill("Neuling")
    await page.getByTestId("signup-terms").click()
    await page.getByTestId("checkin-signup-submit").click()

    // The server-side sign-up mints the ephemeral actsAs session — the
    // fresh account is immediately identified, same as a badge tap.
    await expect(page.getByTestId("identity-strip")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByTestId("identity-strip")).toContainText("Kiosk")
  })

  test("an unclaimed member signs in and completes the kiosk welcome onboarding", async ({
    page,
  }) => {
    // Imported member: users doc with profile data, terms NOT yet accepted.
    const suffix = Date.now()
    const email = `kiosk-unclaimed-${suffix}@werkstattwaedi.ch`
    await getAdminFirestore()
      .collection("users")
      .doc(`e2e-unclaimed-${suffix}`)
      .set({
        firstName: "Ulla",
        lastName: "Wartend",
        email,
        roles: [],
        permissions: [],
        userType: "erwachsen",
        termsAcceptedAt: null,
        billingAddress: {
          company: "",
          street: "Johanniterstrasse 3",
          zip: "8820",
          city: "Wädenswil",
        },
        created: Timestamp.now(),
      })

    await page.goto("/checkin?kiosk")
    await page.getByTestId("checkin-identifier").fill(email)
    await page.getByTestId("checkin-identifier-submit").click()

    // A regular code sign-in — NOT the sign-up dialog (which would overwrite
    // the imported profile with freshly typed data).
    await expect(page.getByTestId("checkin-code-dialog")).toBeVisible()
    await expect(page.getByTestId("checkin-signup-dialog")).not.toBeVisible()
    const entry = await waitForLoginCode(email)
    expect(entry, "debugCode should be present in emulator").toBeTruthy()
    await page.getByTestId("checkin-code-input").fill(entry!.code)
    await page.getByTestId("checkin-code-submit").click()

    // The session is established pre-terms and the kiosk welcome onboarding
    // overlays the wizard (issue #595).
    await expect(page.getByTestId("welcome-onboarding-dialog")).toBeVisible({
      timeout: 10_000,
    })

    // Step 1 · Willkommen
    await page.getByTestId("welcome-next").click()

    // Step 2 · Deine Daten — prefilled from the imported doc, saved through
    // the completeOnboardingKiosk callable.
    await expect(page.getByTestId("welcome-firstname")).toHaveValue("Ulla")
    await expect(page.getByTestId("welcome-street")).toHaveValue(
      "Johanniterstrasse 3"
    )
    await page.getByTestId("welcome-next").click()

    // Step 3 · Nutzungsbestimmungen
    await page.getByTestId("welcome-terms").click()
    await page.getByTestId("welcome-next").click()

    // Step 4 · kiosk flavor: instructions-email offer instead of the
    // member-area links.
    await expect(
      page.getByTestId("kiosk-onboarding-instructions")
    ).toBeVisible()
    await page.getByTestId("kiosk-onboarding-send-instructions").click()
    await expect(
      page.getByTestId("kiosk-onboarding-instructions")
    ).toContainText("E-Mail geschickt")

    // "Zum Check-in" dismisses the overlay — the member is identified.
    await page.getByTestId("welcome-next").click()
    await expect(
      page.getByTestId("welcome-onboarding-dialog")
    ).not.toBeVisible()
    await expect(page.getByTestId("identity-strip")).toBeVisible()
    await expect(page.getByTestId("identity-strip")).toContainText("Ulla")

    // The callable persisted the acceptance — the doc is now complete.
    const doc = await getAdminFirestore()
      .collection("users")
      .doc(`e2e-unclaimed-${suffix}`)
      .get()
    expect(doc.get("termsAcceptedAt")).toBeTruthy()
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
