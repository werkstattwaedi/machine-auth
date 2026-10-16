// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect, type Page } from "@playwright/test"
import { FieldValue } from "firebase-admin/firestore"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import {
  clearCollections,
  getAdminFirestore,
  installFakeKioskBridge,
  openGuestSection,
  waitForLoginCode,
  KIOSK_DESKTOP_ONLY,
} from "./helpers"
import { AUTH_USER_EMAIL, NFC_TAG_UID } from "./global-setup"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// No account exists for this address, so the identifier submit opens the
// sign-up dialog (via "code"). Nothing ever signs it up.
const SIGNUP_SCREENSHOT_EMAIL = "screenshot-signup@werkstattwaedi.ch"

/** Navigate to checkout — the check-in step is shown directly, with the
 *  account section of the switcher as the anonymous default. */
async function goToCheckin(page: Page) {
  await page.goto("/")
  await expect(page.getByTestId("checkin-seg-account")).toBeVisible({
    timeout: 10_000,
  })
}

/** Fonts + layout settle guard: the hero affordance is `h-auto`, so late
 *  webfont swaps reflow the page and ghost every glyph edge in a capture.
 *  Wait for fonts, then for the page height to stop changing. */
async function settleLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  let prevScrollHeight = -1
  await expect
    .poll(async () => {
      const height = await page.evaluate(
        () => document.documentElement.scrollHeight,
      )
      const settled = height === prevScrollHeight
      prevScrollHeight = height
      return settled
    })
    .toBe(true)
}

test.describe("Check-in step screenshots", () => {
  test("account section — anonymous default", async ({ page }) => {
    await goToCheckin(page)

    // Switcher (account active), member note, identifier field with the
    // inline submit arrow, Google button below the "oder" divider.
    await expect(page.getByTestId("checkin-identifier")).toBeVisible()
    await settleLayout(page)
    await expect(page).toHaveScreenshot("checkin-account-idle.png")
  })

  test("code entry dialog", async ({ page }) => {
    await clearCollections("loginCodes")
    await goToCheckin(page)

    await page.getByTestId("checkin-identifier").fill(AUTH_USER_EMAIL)
    await page.getByTestId("checkin-identifier-submit").click()
    await expect(page.getByTestId("checkin-code-dialog")).toBeVisible({
      timeout: 10_000,
    })

    await settleLayout(page)
    await expect(page).toHaveScreenshot("checkin-code-dialog.png")
  })

  test("code entry dialog — wrong code (error notice)", async ({ page }) => {
    await clearCollections("loginCodes")
    await goToCheckin(page)

    await page.getByTestId("checkin-identifier").fill(AUTH_USER_EMAIL)
    await page.getByTestId("checkin-identifier-submit").click()
    await expect(page.getByTestId("checkin-code-dialog")).toBeVisible({
      timeout: 10_000,
    })
    // Wait for the real code so verify reports "wrong code", not "no code".
    await waitForLoginCode(AUTH_USER_EMAIL)

    await page.getByTestId("checkin-code-input").fill("000000")
    await page.getByTestId("checkin-code-submit").click()
    await expect(page.getByTestId("checkin-code-error")).toContainText(
      "Code falsch.",
    )

    await settleLayout(page)
    await expect(page).toHaveScreenshot("checkin-code-dialog-error.png")
  })

  test("code entry dialog — resend (info notice)", async ({ page }) => {
    await clearCollections("loginCodes")
    await goToCheckin(page)

    await page.getByTestId("checkin-identifier").fill(AUTH_USER_EMAIL)
    await page.getByTestId("checkin-identifier-submit").click()
    await expect(page.getByTestId("checkin-code-dialog")).toBeVisible({
      timeout: 10_000,
    })
    await waitForLoginCode(AUTH_USER_EMAIL)

    // Inside the 60s per-email throttle, so the resend is acknowledged
    // with the "already sent — still valid" info bar.
    await page.getByTestId("checkin-code-resend").click()
    await expect(page.getByTestId("checkin-code-notice")).toContainText(
      "der Code ist noch gültig",
    )

    await settleLayout(page)
    await expect(page).toHaveScreenshot("checkin-code-dialog-resend.png")
  })

  // Issue #661: the sign-up dialog is taller than a phone viewport; the
  // mobile baseline documents that the sticky "Konto erstellen" footer is
  // visible without scrolling.
  test("sign-up dialog", async ({ page }) => {
    await clearCollections("loginCodes")
    await goToCheckin(page)

    await page.getByTestId("checkin-identifier").fill(SIGNUP_SCREENSHOT_EMAIL)
    await page.getByTestId("checkin-identifier-submit").click()
    await expect(page.getByTestId("checkin-signup-dialog")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByTestId("checkin-signup-submit")).toBeVisible()

    await settleLayout(page)
    await expect(page).toHaveScreenshot("checkin-signup-dialog.png")
  })

  test("empty guest form", async ({ page }) => {
    await goToCheckin(page)
    await openGuestSection(page)

    await expect(page).toHaveScreenshot("checkin-empty.png")
  })

  test("two persons with company type", async ({ page }) => {
    await goToCheckin(page)
    await openGuestSection(page)

    // Add second person
    await page.getByRole("button", { name: "Person hinzufügen" }).click()
    await expect(page.getByRole("heading", { name: "Person 2" })).toBeVisible()

    // Set second person to Firma
    const person2 = page.getByTestId("person-card").nth(1)
    await person2.getByText("Firma").click()

    // Wait for billing address fields to appear
    await expect(person2.getByText("Rechnungsadresse")).toBeVisible()

    await expect(page).toHaveScreenshot("checkin-two-persons-company.png")
  })

  test("validation errors after submit", async ({ page }) => {
    await goToCheckin(page)
    await openGuestSection(page)

    // Click Weiter without filling anything
    await page.getByRole("button", { name: "Weiter" }).click()

    // Wait for error messages to appear
    await expect(page.getByText("Vorname ist erforderlich.")).toBeVisible()

    await expect(page).toHaveScreenshot("checkin-validation-errors.png")
  })

  test("kiosk mode — NFC hint visible", async ({ page, isMobile }) => {
    test.skip(isMobile, KIOSK_DESKTOP_ONLY)
    await page.goto("/?kiosk")
    await expect(page.getByTestId("checkin-seg-account")).toBeVisible({
      timeout: 10_000,
    })

    // Kiosk account section: identifier field, then the animated hero
    // affordance (fob + reader scene) below the "oder" divider. No Google
    // button at the shared terminal.
    const affordance = page.getByTestId("nfc-affordance")
    await expect(affordance).toHaveAttribute("data-mode", "hero")
    await expect(
      affordance.getByText("an den Leser halten", { exact: false }),
    ).toBeVisible()
    await expect(page.getByText("Mit Google anmelden")).not.toBeVisible()

    await settleLayout(page)
    // Scroll to the page end so the baseline captures the whole hero box
    // (it sits below the field and may exceed the remaining viewport).
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page).toHaveScreenshot("checkin-kiosk-nfc-hint.png")
  })

  test("logged-in user — sign-out in person card", async ({ page }) => {
    // Clear prior loginCodes so the per-email 60 s rate limit doesn't
    // reject this test when it follows another that signed in.
    await clearCollections("loginCodes")

    // Sign in via /login (6-digit code flow)
    await page.goto("/login")
    await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
    await page.getByTestId("login-email-submit").click()
    await expect(page.getByTestId("login-code-stage")).toBeVisible({ timeout: 5000 })

    const entry = await waitForLoginCode(AUTH_USER_EMAIL)
    expect(entry).toBeTruthy()
    await page.getByTestId("login-code-input").fill(entry!.code)
    await page.getByTestId("login-code-submit").click()

    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 })

    // Navigate to checkout
    await page.goto("/")
    await expect(page.getByTestId("identity-strip").first()).toBeVisible({ timeout: 10_000 })

    await expect(page).toHaveScreenshot("checkin-logged-in.png")
  })

  test("two persons scrolled — sticky nav bar at bottom", async ({ page }) => {
    await goToCheckin(page)
    await openGuestSection(page)

    // Add second person so the page content is taller than the viewport
    await page.getByRole("button", { name: "Person hinzufügen" }).click()
    await expect(page.getByRole("heading", { name: "Person 2" })).toBeVisible()

    // Scroll down so content above the fold is visible and sticky nav is at bottom
    await page.evaluate(() => window.scrollBy(0, 300))

    // Capture viewport only — shows sticky buttons anchored to viewport bottom
    await expect(page).toHaveScreenshot("checkin-scrolled-sticky-nav.png")
  })

  // Issue #732: right after a badge tap at the kiosk, "Besuch starten" fills
  // and starts the visit on its own. The fill is frozen part-way (test hook)
  // so the baseline is deterministic and the visit never starts.
  test("kiosk badge tap — Besuch starten countdown", async ({ page, isMobile }) => {
    test.skip(isMobile, KIOSK_DESKTOP_ONLY)
    await clearCollections("checkouts")
    // The seeded picc encodes counter=0; reset the SDM replay defense.
    await getAdminFirestore()
      .collection("tokens")
      .doc(NFC_TAG_UID)
      .update({ lastSdmCounter: FieldValue.delete() })
    const { picc, cmac } = JSON.parse(
      readFileSync(path.resolve(__dirname, ".e2e-data.json"), "utf-8"),
    ) as { picc: string; cmac: string }

    await installFakeKioskBridge(page, { freezeAutoStart: true })
    await page.goto(`/checkin?kiosk=&picc=${picc}&cmac=${cmac}`)
    await expect(page.getByTestId("checkin-start-visit")).toHaveAttribute(
      "data-countdown",
      "running",
      { timeout: 15_000 },
    )

    await settleLayout(page)
    await expect(page).toHaveScreenshot("checkin-kiosk-countdown.png")
  })
})
