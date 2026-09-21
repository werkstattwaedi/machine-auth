// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for issue #652 — the cart tables on the "Kosten" step
 * must keep machine and material names readable on a phone. Before the fix
 * the four `PositionTable` columns stayed side by side at 375px and the
 * name column collapsed to "Sta…" / "Dre…" / "Kirschbau…".
 *
 * The fixture reproduces the rows from the issue in one Holz block: a
 * pinned machine with an hours input ("Stationäre Maschinen"), an NFC
 * machine row with a session breakdown ("Drechselbank") and an area-priced
 * material with a subtitle ("Kirschbaum 24 mm, gehobelt", 60×40 cm).
 *
 * The pinned machine is pinned on `holz` only for this spec (global-setup
 * pins on `metall`) and the config is restored afterwards. Playwright runs
 * with `workers: 1`, so no other spec observes the temporary config.
 */

import { test, expect, type Page } from "@playwright/test"
import {
  clearCollections,
  getAdminFirestore,
  waitForLoginCode,
} from "./helpers"
import { AUTH_USER_EMAIL, AUTH_USER_ID } from "./global-setup"
import { Timestamp, FieldValue } from "firebase-admin/firestore"

const CHECKOUT_ID = "e2e-visit-long-names-checkout-001"
const NFC_ITEM_ID = "e2e-visit-long-names-item-nfc"
const MATERIAL_ITEM_ID = "e2e-visit-long-names-item-material"
const MACHINE_ID = "e2e-visit-long-names-machine-001"
const USAGE_ID = "e2e-visit-long-names-usage-001"
const PINNED_CATALOG_ID = "e2e-machine-holz-long-name"

const PINNED_NAME = "Stationäre Maschinen"
const NFC_NAME = "Drechselbank"
const MATERIAL_NAME = "Kirschbaum 24 mm, gehobelt"

function todayAt(hour: number, minute: number): Date {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d
}

async function seedLongNamesFixture() {
  const db = getAdminFirestore()
  const userRef = db.collection("users").doc(AUTH_USER_ID)
  const checkoutRef = db.collection("checkouts").doc(CHECKOUT_ID)
  const machineRef = db.collection("machine").doc(MACHINE_ID)
  const nfcItemRef = checkoutRef.collection("items").doc(NFC_ITEM_ID)

  // Pinned MaCo-less machine (issue #105) with a name that overflows the
  // mobile name column next to its hours input.
  await db.collection("catalog").doc(PINNED_CATALOG_ID).set({
    code: "9101",
    name: PINNED_NAME,
    workshops: ["holz"],
    category: ["Maschinen"],
    active: true,
    userCanAdd: false,
    type: "machine",
    description: "Manuelle Stundenerfassung (kein MaCo)",
    variants: [
      {
        id: "default",
        pricingModel: "time",
        unitPrice: { default: 40, member: 20 },
      },
    ],
  })
  await db
    .doc("config/pricing")
    .update({ "workshops.holz.pinnedMachines": [PINNED_CATALOG_ID] })

  await machineRef.set({
    name: NFC_NAME,
    workshop: "holz",
    requiredPermission: [],
    created: FieldValue.serverTimestamp(),
  })

  await checkoutRef.set({
    userId: userRef,
    status: "open",
    usageType: "regular",
    created: FieldValue.serverTimestamp(),
    workshopsVisited: ["holz"],
    persons: [],
  })

  // 60 min × CHF 25.00/h → CHF 25.00; the session makes the row expandable
  // so the chevron gutter renders exactly as in the issue's screenshot.
  await nfcItemRef.set({
    workshop: "holz",
    description: NFC_NAME,
    origin: "nfc",
    type: "machine",
    catalogId: null,
    pricingModel: "time",
    created: FieldValue.serverTimestamp(),
    quantity: 1.0,
    unitPrice: 25,
    totalPrice: 25,
    formInputs: null,
  })
  await db.collection("usage_machine").doc(USAGE_ID).set({
    userId: userRef,
    machine: machineRef,
    startTime: Timestamp.fromDate(todayAt(10, 0)),
    endTime: Timestamp.fromDate(todayAt(11, 0)),
    endReason: "user",
    checkoutItemRef: nfcItemRef,
    workshop: "holz",
    created: FieldValue.serverTimestamp(),
  })

  // 60×40 cm = 0.24 m² × CHF 10.00/m² → CHF 2.40, with the raw size as the
  // subtitle under the (long) name.
  await checkoutRef.collection("items").doc(MATERIAL_ITEM_ID).set({
    workshop: "holz",
    description: MATERIAL_NAME,
    origin: "manual",
    catalogId: "e2e-item-1",
    variantId: "default",
    pricingModel: "area",
    created: FieldValue.serverTimestamp(),
    quantity: 0.24,
    unitPrice: 10,
    totalPrice: 2.4,
    formInputs: [
      { quantity: 60, unit: "cm" },
      { quantity: 40, unit: "cm" },
    ],
  })
}

async function clearLongNamesFixture() {
  const db = getAdminFirestore()
  await db
    .doc("config/pricing")
    .update({ "workshops.holz.pinnedMachines": FieldValue.delete() })
    .catch(() => {})
  await db.collection("catalog").doc(PINNED_CATALOG_ID).delete().catch(() => {})
  await db.collection("usage_machine").doc(USAGE_ID).delete().catch(() => {})
  const checkoutRef = db.collection("checkouts").doc(CHECKOUT_ID)
  const items = await checkoutRef.collection("items").get()
  await Promise.all(items.docs.map((d) => d.ref.delete()))
  await checkoutRef.delete().catch(() => {})
  await db.collection("machine").doc(MACHINE_ID).delete().catch(() => {})
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

test.describe("Visit page — long machine and material names (issue #652)", () => {
  test.beforeEach(async () => {
    await clearCollections("checkouts", "loginCodes")
    await clearLongNamesFixture()
    await seedLongNamesFixture()
  })

  test.afterEach(async () => {
    await clearLongNamesFixture()
  })

  test("names stay fully readable in the cart tables", async ({ page }) => {
    await signIn(page)
    await page.goto("/visit")

    const block = page.getByTestId("workshop-block-holz")
    await expect(block).toBeVisible({ timeout: 10_000 })
    await expect(block.getByText(PINNED_NAME)).toBeVisible()
    await expect(block.getByText(NFC_NAME)).toBeVisible()
    await expect(block.getByText(MATERIAL_NAME)).toBeVisible()
    await expect(block.getByText("60×40 cm")).toBeVisible()

    // Deterministic guard independent of the pixel baseline: a title that
    // is ellipsised (`text-overflow: ellipsis` + `white-space: nowrap`) has
    // scrollWidth > clientWidth. Every title must fit its box, wrapping if
    // necessary. Also fails if the table pushes the card wider than the
    // viewport.
    const overflowing = await block.evaluate((el) => {
      const cells = el.querySelectorAll<HTMLElement>('[role="cell"] > span')
      return Array.from(cells)
        .filter((s) => s.scrollWidth > s.clientWidth)
        .map((s) => s.textContent ?? "")
    })
    expect(overflowing).toEqual([])
    const pageOverflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(pageOverflows).toBe(false)

    // Neutral focus so the empty hours input has no focus ring.
    await page.locator("h1").first().click()
    await expect(block).toHaveScreenshot("visit-cart-long-names.png")
  })
})
