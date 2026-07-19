// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for issue #492 — "Zu breit in iOS".
 *
 * iOS Safari auto-zooms the page when a focused form control's computed
 * font-size is below 16px, and the zoom persists after blur — in an SPA it
 * then survives navigation, so the whole app appears cropped/too wide on
 * every subsequent page. The reported viewport (344px on a 393pt screen)
 * matches a 16/14 zoom exactly: the signature of a focused 14px (text-sm)
 * control.
 *
 * The zoom itself can't be reproduced in chromium, but its trigger condition
 * can: at mobile widths, every focusable text-entry control must have a
 * computed font-size of at least 16px. Desktop widths are exempt — the
 * md:text-sm downshift is fine there because desktop browsers don't
 * focus-zoom.
 */

import { test, expect, type Page } from "@playwright/test"
import {
  clearCollections,
  getAdminFirestore,
  waitForLoginCode,
} from "./helpers"
import { AUTH_USER_EMAIL, AUTH_USER_ID } from "./global-setup"
import { FieldValue } from "firebase-admin/firestore"

const MIN_FONT_PX = 16
const CHECKOUT_ID = "e2e-ios-zoom-checkout-001"

/**
 * Collects every rendered control that would trigger the iOS focus zoom.
 * Checkbox/radio and friends are exempt: they render no editable text, so
 * iOS does not zoom them. Disabled controls can't receive focus.
 */
async function collectZoomTriggers(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const EXEMPT_TYPES = new Set([
      "checkbox",
      "radio",
      "hidden",
      "range",
      "file",
      "button",
      "submit",
      "reset",
      "image",
      "color",
    ])
    const offenders: string[] = []
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>("input, select, textarea"),
    )) {
      const type = (el.getAttribute("type") ?? "text").toLowerCase()
      if (el.tagName === "INPUT" && EXEMPT_TYPES.has(type)) continue
      if ((el as HTMLInputElement).disabled) continue
      if (!(el.checkVisibility?.() ?? true)) continue
      const size = parseFloat(getComputedStyle(el).fontSize)
      if (size < min) {
        const label =
          el.getAttribute("data-testid") ??
          el.getAttribute("aria-label") ??
          el.getAttribute("placeholder") ??
          el.tagName.toLowerCase()
        offenders.push(`${label} (${size}px)`)
      }
    }
    return offenders
  }, MIN_FONT_PX)
}

async function expectNoZoomTriggers(page: Page, context: string) {
  expect(
    await collectZoomTriggers(page),
    `${context}: sub-16px focusable controls trigger the iOS auto-zoom (issue #492)`,
  ).toEqual([])
}

async function signIn(page: Page) {
  await page.goto("/login")
  await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
  await page.getByTestId("login-email-submit").click()
  await expect(page.getByTestId("login-code-stage")).toBeVisible({
    timeout: 5000,
  })
  const entry = await waitForLoginCode(AUTH_USER_EMAIL)
  expect(entry).toBeTruthy()
  await page.getByTestId("login-code-input").fill(entry!.code)
  await page.getByTestId("login-code-submit").click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 10_000,
  })
}

async function seedOpenCheckout() {
  const db = getAdminFirestore()
  await db
    .collection("checkouts")
    .doc(CHECKOUT_ID)
    .set({
      userId: db.collection("users").doc(AUTH_USER_ID),
      status: "open",
      usageType: "regular",
      created: FieldValue.serverTimestamp(),
      workshopsVisited: ["makerspace"],
      persons: [],
    })
}

async function clearCheckoutFixture() {
  const db = getAdminFirestore()
  const checkoutRef = db.collection("checkouts").doc(CHECKOUT_ID)
  const items = await checkoutRef.collection("items").get()
  await Promise.all(items.docs.map((d) => d.ref.delete()))
  await checkoutRef.delete().catch(() => {})
}

test.describe("iOS focus-zoom guard — no sub-16px controls at mobile widths (issue #492)", () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(!isMobile, "iOS focus-zoom only matters at mobile widths")
    await clearCollections("loginCodes")
  })

  test("sign-in surfaces (login page, check-in email + code dialog)", async ({
    page,
  }) => {
    // /login email stage, then its code stage.
    await page.goto("/login")
    await expect(page.getByTestId("login-email-input")).toBeVisible()
    await expectNoZoomTriggers(page, "/login email stage")

    await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
    await page.getByTestId("login-email-submit").click()
    await expect(page.getByTestId("login-code-stage")).toBeVisible({
      timeout: 5000,
    })
    await expectNoZoomTriggers(page, "/login code stage")

    // Check-in identifier form (the surface in the issue screenshots), then
    // the OTP dialog. The dialog's hidden input is the autoFocus timing
    // hazard: input-otp sets its font-size from --root-height only after
    // mount, so the inherited size the scan sees here is what iOS reads at
    // focus time.
    await clearCollections("loginCodes")
    await page.goto("/checkin?kiosk")
    await expect(page.getByTestId("checkin-identifier")).toBeVisible()
    await expectNoZoomTriggers(page, "/checkin identifier form")

    await page.getByTestId("checkin-identifier").fill(AUTH_USER_EMAIL)
    await page.getByTestId("checkin-identifier-submit").click()
    await expect(page.getByTestId("checkin-code-dialog")).toBeVisible({
      timeout: 10_000,
    })
    await expectNoZoomTriggers(page, "/checkin code dialog")
  })

  test("material picker (search + quantity form)", async ({ page }) => {
    await clearCheckoutFixture()
    await seedOpenCheckout()
    try {
      await signIn(page)

      // The page from the original report: picker sheet with autoFocus search.
      await page.goto("/visit/add/workshop/makerspace")
      const search = page.getByPlaceholder("Material suchen…")
      await expect(search).toBeVisible({ timeout: 10_000 })
      await expectNoZoomTriggers(page, "picker search")

      // Open a material form — its quantity input also autoFocuses.
      await page.getByText("Filament", { exact: true }).click()
      await expect(page.locator('input[type="number"]').first()).toBeVisible({
        timeout: 10_000,
      })
      await expectNoZoomTriggers(page, "picker quantity form")
    } finally {
      await clearCheckoutFixture()
    }
  })
})
