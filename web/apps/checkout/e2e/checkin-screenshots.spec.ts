// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect, type Page } from "@playwright/test"
import {
  clearCollections,
  seedMembershipState,
  waitForLoginCode,
} from "./helpers"
import { AUTH_USER_EMAIL } from "./global-setup"

/** Navigate to checkout — check-in step is shown directly */
async function goToCheckin(page: Page) {
  await page.goto("/")
  await expect(page.getByText("Deine Angaben")).toBeVisible({ timeout: 10_000 })
}

test.describe("Check-in step screenshots", () => {
  // The family-owner test seeds an `active-family-owner` membership and
  // stamps `activeMembership` on the auth user doc. Without an explicit
  // reset, that stamp leaks into later test files (notably
  // checkout-screenshots Step 4) and surfaces the "Sammelrechnung" tab
  // when those tests expect a non-member view.
  test.afterAll(async () => {
    const uid = process.env.E2E_AUTH_USER_UID
    if (uid) await seedMembershipState(uid, { kind: "none" })
  })

  test("empty form", async ({ page }) => {
    await goToCheckin(page)

    await expect(page).toHaveScreenshot("checkin-empty.png")
  })

  test("two persons with company type", async ({ page }) => {
    await goToCheckin(page)

    // Add second person
    await page.getByRole("button", { name: "Person hinzufügen" }).click()
    await expect(page.getByText("Person 2")).toBeVisible()

    // Set second person to Firma
    const person2 = page.getByTestId("person-card").nth(1)
    await person2.getByText("Firma").click()

    // Wait for billing address fields to appear
    await expect(person2.getByText("Rechnungsadresse")).toBeVisible()

    await expect(page).toHaveScreenshot("checkin-two-persons-company.png")
  })

  test("validation errors after submit", async ({ page }) => {
    await goToCheckin(page)

    // Click Weiter without filling anything
    await page.getByRole("button", { name: "Weiter" }).click()

    // Wait for error messages to appear
    await expect(page.getByText("Vorname ist erforderlich.")).toBeVisible()

    await expect(page).toHaveScreenshot("checkin-validation-errors.png")
  })

  test("anonymous browser — login hint visible", async ({ page }) => {
    await goToCheckin(page)

    await expect(page.getByText("Bereits registriert oder Konto erstellen?")).toBeVisible()

    await expect(page).toHaveScreenshot("checkin-login-hint.png")
  })

  test("kiosk mode — NFC hint visible", async ({ page }) => {
    await page.goto("/?kiosk")
    // Heading role: the affordance hero subline also contains the words
    // "Deine Angaben", so a plain text locator would be ambiguous.
    await expect(
      page.getByRole("heading", { name: "Deine Angaben" }),
    ).toBeVisible({ timeout: 10_000 })

    // Untouched form → the animated hero affordance (fob + reader scene +
    // own-device QR) below the form behind the ODER divider.
    const affordance = page.getByTestId("nfc-affordance")
    await expect(affordance).toHaveAttribute("data-mode", "hero")
    await expect(
      affordance.getByText("an den Leser halten", { exact: false }),
    ).toBeVisible()
    await expect(page.getByText("ODER", { exact: true })).toBeVisible()

    // Settle before scrolling. The hero box is `h-auto`, so the page height
    // is content-driven, and the check-in form + hero copy reflow when the
    // webfont finishes loading. Scrolling to the bottom before that reflow
    // lands on a stale offset; the late font swap then shifts the whole
    // capture ~1px, ghosting every glyph edge for a ~2% diff over the 1%
    // threshold (flaky). Wait for fonts, then for the page height to stop
    // changing (two equal consecutive reads), before scrolling. Mirrors the
    // settle guard in the sibling "collapses while typing" test below.
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

    // Scroll to the page end so the baseline captures the whole hero box
    // (it sits below the form and exceeds the remaining viewport).
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page).toHaveScreenshot("checkin-kiosk-nfc-hint.png")
  })

  test("kiosk mode — NFC affordance collapses while typing", async ({ page }) => {
    await page.goto("/?kiosk")
    await expect(
      page.getByRole("heading", { name: "Deine Angaben" }),
    ).toBeVisible({ timeout: 10_000 })

    await page.getByTestId("person-card").first().getByRole("textbox").first().fill("Max")

    const affordance = page.getByTestId("nfc-affordance")
    await expect(affordance).toHaveAttribute("data-mode", "compact")
    await expect(
      page.getByText("Badge an den Leser halten, um deine Daten zu laden"),
    ).toBeVisible()

    // The hero→compact height tween (450 ms) changes the page height. A bare
    // "height < 50" check fires the instant the ease-out curve dips under 50px
    // while it's still shrinking toward its 46px resting height, so the
    // subsequent scroll lands on a run-dependent offset and every line ghosts
    // a few pixels (flaky pass/fail across CI runs). Wait for the height to
    // stop changing — two equal consecutive reads at rest — before scrolling.
    let prevHeight = -1
    await expect
      .poll(async () => {
        const height = Math.round((await affordance.boundingBox())?.height ?? 0)
        const settled = height === prevHeight && height < 50
        prevHeight = height
        return settled
      })
      .toBe(true)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page).toHaveScreenshot("checkin-kiosk-nfc-hint-collapsed.png")
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
    await expect(page.getByText("Abmelden")).toBeVisible({ timeout: 10_000 })

    await expect(page).toHaveScreenshot("checkin-logged-in.png")
  })

  // Issue #209: family-owner check-in surfaces quick-add buttons for
  // co-members not yet on the visit, plus a removable first card. The
  // screenshot acts as both pixel-regression and the only end-to-end
  // verification that the wizard's `useCollection` chain reads the
  // membership + co-member docs through the (relaxed) Firestore rules.
  test("logged-in family owner — quick-add buttons visible", async ({ page }) => {
    await clearCollections("loginCodes")

    // Sign in as the seeded auth user via the 6-digit code flow.
    await page.goto("/login")
    await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
    await page.getByTestId("login-email-submit").click()
    await expect(page.getByTestId("login-code-stage")).toBeVisible({ timeout: 5000 })

    const entry = await waitForLoginCode(AUTH_USER_EMAIL)
    expect(entry).toBeTruthy()
    await page.getByTestId("login-code-input").fill(entry!.code)
    await page.getByTestId("login-code-submit").click()
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 10_000,
    })

    // Seed an active family membership with two co-members so the
    // wizard surfaces two quick-add buttons.
    const uid = process.env.E2E_AUTH_USER_UID!
    await seedMembershipState(uid, {
      kind: "active-family-owner",
      coMembers: [
        { firstName: "Lia", lastName: "Pfeffer", userType: "kind" },
        { firstName: "Yvonne", lastName: "Pfeiffer" },
      ],
    })

    await page.goto("/")
    await expect(page.getByText("Deine Angaben")).toBeVisible({
      timeout: 10_000,
    })
    // Both quick-add buttons render. Use exact text so we don't match the
    // generic "Person hinzufügen" button.
    await expect(
      page.getByRole("button", { name: /Lia Pfeffer/ }),
    ).toBeVisible({ timeout: 5_000 })
    await expect(
      page.getByRole("button", { name: /Yvonne Pfeiffer/ }),
    ).toBeVisible()

    await expect(page).toHaveScreenshot("checkin-family-owner-quick-add.png")
  })

  test("two persons scrolled — sticky nav bar at bottom", async ({ page }) => {
    await goToCheckin(page)

    // Add second person so the page content is taller than the viewport
    await page.getByRole("button", { name: "Person hinzufügen" }).click()
    await expect(page.getByText("Person 2")).toBeVisible()

    // Scroll down so content above the fold is visible and sticky nav is at bottom
    await page.evaluate(() => window.scrollBy(0, 300))

    // Capture viewport only — shows sticky buttons anchored to viewport bottom
    await expect(page).toHaveScreenshot("checkin-scrolled-sticky-nav.png")
  })
})
