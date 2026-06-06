// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Coverage for issue #105 — manual machine-hour entry. A workshop with
 * `config/pricing.workshops[].pinnedMachines` shows an always-visible hours
 * input on the cost step (no MaCo required). Locks the pinned-row layout and
 * verifies entering hours computes the line price.
 *
 * Uses the `metall` workshop, which global-setup seeds with the pinned
 * "Standbohrmaschine" (CHF 30/h) — kept off `holz` so the issue-#214
 * visit-machine screenshots stay unaffected.
 */

import { test, expect, type Page } from "@playwright/test"
import {
  clearCollections,
  getAdminFirestore,
  waitForLoginCode,
} from "./helpers"
import { AUTH_USER_EMAIL, AUTH_USER_ID } from "./global-setup"
import { FieldValue } from "firebase-admin/firestore"

const CHECKOUT_ID = "e2e-visit-pinned-checkout-001"

async function seedPinnedFixture() {
  const db = getAdminFirestore()
  const userRef = db.collection("users").doc(AUTH_USER_ID)
  // An open checkout with `metall` visited renders the metall section even
  // before any item exists, so the pinned hours row is shown by default.
  await db
    .collection("checkouts")
    .doc(CHECKOUT_ID)
    .set({
      userId: userRef,
      status: "open",
      usageType: "regular",
      created: FieldValue.serverTimestamp(),
      workshopsVisited: ["metall"],
      persons: [],
    })
}

async function clearPinnedFixture() {
  const db = getAdminFirestore()
  const checkoutRef = db.collection("checkouts").doc(CHECKOUT_ID)
  const items = await checkoutRef.collection("items").get()
  await Promise.all(items.docs.map((d) => d.ref.delete()))
  await checkoutRef.delete().catch(() => {})
}

async function signIn(page: Page) {
  await clearCollections("loginCodes")
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

test.describe("Visit page — pinned machine hours (issue #105)", () => {
  test.beforeEach(async () => {
    await clearCollections("checkouts", "loginCodes")
    await clearPinnedFixture()
    await seedPinnedFixture()
  })

  test.afterEach(async () => {
    await clearPinnedFixture()
  })

  test("renders the pinned machine row with an hours input", async ({
    page,
  }) => {
    await signIn(page)
    await page.goto("/visit")

    const block = page.getByTestId("workshop-block-metall")
    await expect(block).toBeVisible({ timeout: 10_000 })
    // Machine name + its hourly rate are shown by default — no MaCo, no
    // material picker, just the always-visible hours input.
    await expect(block.getByText("Standbohrmaschine")).toBeVisible()
    await expect(
      block.getByLabel("Stunden Standbohrmaschine"),
    ).toBeVisible()

    // Neutral focus so the empty input has no focus ring in the snapshot.
    await page.locator("h1").first().click()
    await expect(block).toHaveScreenshot("visit-pinned-machine-empty.png")
  })

  test("entering hours computes the line price", async ({ page }) => {
    await signIn(page)
    await page.goto("/visit")

    const block = page.getByTestId("workshop-block-metall")
    await expect(block).toBeVisible({ timeout: 10_000 })

    // 2 h × CHF 30/h = CHF 60.00 — the row's price column reflects the live
    // input immediately (exact match: "CHF 60.00" subtotal is separate).
    await block.getByLabel("Stunden Standbohrmaschine").fill("2")
    await expect(block.getByText("60.00", { exact: true })).toBeVisible()

    // Blur commits the line; the workshop subtotal picks it up.
    await page.locator("h1").first().click()
    await expect(block.getByText(/Zwischentotal Metall/)).toBeVisible()
    await expect(block.getByText("CHF 60.00")).toBeVisible({ timeout: 10_000 })
  })
})
