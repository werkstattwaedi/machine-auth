// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for issue #214 — visit page machine row layout
 * (collapsed + expanded). Locks the column alignment shared with
 * `PositionTable` (Menge | Kosten | Preis) and the per-session
 * breakdown column order (Maschine | Start | Dauer).
 */

import { test, expect, type Page } from "@playwright/test"
import {
  clearCollections,
  getAdminFirestore,
  waitForLoginCode,
} from "./helpers"
import { AUTH_USER_EMAIL, AUTH_USER_ID } from "./global-setup"
import { Timestamp, FieldValue } from "firebase-admin/firestore"

const CHECKOUT_ID = "e2e-visit-machine-checkout-001"
const ITEM_ID = "e2e-visit-machine-item-001"
const MACHINE_ID = "e2e-visit-machine-001"
const USAGE_A_ID = "e2e-visit-machine-usage-001"
const USAGE_B_ID = "e2e-visit-machine-usage-002"

// Stable timestamps so the screenshot doesn't drift across runs. All times
// are in the local "today" so the breakdown table renders without a date
// header (matches the design handoff).
function todayAt(hour: number, minute: number): Date {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d
}

async function seedVisitMachineFixture() {
  const db = getAdminFirestore()
  const userRef = db.collection("users").doc(AUTH_USER_ID)
  const checkoutRef = db.collection("checkouts").doc(CHECKOUT_ID)
  const itemRef = checkoutRef.collection("items").doc(ITEM_ID)
  const machineRef = db.collection("machine").doc(MACHINE_ID)
  const permissionRef = db.collection("permission").doc("laser")

  await machineRef.set({
    name: "CO₂ Laser",
    workshop: "holz",
    requiredPermission: [permissionRef],
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

  // Total = 60 min = 1.0 h × CHF 12.00/h → CHF 12.00. Two sessions of 30
  // min each visualise the per-session breakdown clearly without bloating
  // the screenshot.
  await itemRef.set({
    workshop: "holz",
    description: "CO₂ Laser",
    origin: "nfc",
    type: "machine",
    catalogId: null,
    pricingModel: "time",
    created: FieldValue.serverTimestamp(),
    quantity: 1.0,
    unitPrice: 12,
    totalPrice: 12,
    formInputs: null,
  })

  const sessionA = {
    userId: userRef,
    machine: machineRef,
    startTime: Timestamp.fromDate(todayAt(10, 0)),
    endTime: Timestamp.fromDate(todayAt(10, 30)),
    endReason: "user",
    checkoutItemRef: itemRef,
    workshop: "holz",
    created: FieldValue.serverTimestamp(),
  }
  const sessionB = {
    userId: userRef,
    machine: machineRef,
    startTime: Timestamp.fromDate(todayAt(13, 15)),
    endTime: Timestamp.fromDate(todayAt(13, 45)),
    endReason: "user",
    checkoutItemRef: itemRef,
    workshop: "holz",
    created: FieldValue.serverTimestamp(),
  }
  await db.collection("usage_machine").doc(USAGE_A_ID).set(sessionA)
  await db.collection("usage_machine").doc(USAGE_B_ID).set(sessionB)
}

async function clearVisitMachineFixture() {
  const db = getAdminFirestore()
  await db.collection("usage_machine").doc(USAGE_A_ID).delete().catch(() => {})
  await db.collection("usage_machine").doc(USAGE_B_ID).delete().catch(() => {})
  await db
    .collection("checkouts")
    .doc(CHECKOUT_ID)
    .collection("items")
    .doc(ITEM_ID)
    .delete()
    .catch(() => {})
  await db.collection("checkouts").doc(CHECKOUT_ID).delete().catch(() => {})
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

test.describe("Visit page — machine row alignment (issue #214)", () => {
  test.beforeEach(async () => {
    await clearCollections("checkouts", "loginCodes")
    await clearVisitMachineFixture()
    await seedVisitMachineFixture()
  })

  test.afterEach(async () => {
    await clearVisitMachineFixture()
  })

  test("collapsed machine row — shared PositionTable columns", async ({ page }) => {
    await signIn(page)
    await page.goto("/visit")

    // The visit page renders the workshop block directly when an open
    // checkout has items in that workshop. Wait for the machine row to
    // render so the screenshot is stable.
    await expect(page.getByTestId("workshop-block-holz")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText("CO₂ Laser")).toBeVisible()

    // Click a neutral spot so no input has focus.
    await page.locator("h1").first().click()

    await expect(page).toHaveScreenshot("visit-machine-collapsed.png")
  })

  test("expanded machine row — Maschine | Start | Dauer breakdown", async ({ page }) => {
    await signIn(page)
    await page.goto("/visit")

    await expect(page.getByTestId("workshop-block-holz")).toBeVisible({
      timeout: 10_000,
    })

    // The chevron sits in the leading gutter of the shared PositionTable.
    // It's the only "Aufklappen" button on the page.
    await page.getByRole("button", { name: "Aufklappen" }).click()

    // Wait for the per-session breakdown to render — Start column header
    // is unique to the expanded row.
    await expect(
      page.getByRole("columnheader", { name: "Start" }),
    ).toBeVisible()

    // Click a neutral spot so the chevron isn't focus-ringed.
    await page.locator("h1").first().click()

    await expect(page).toHaveScreenshot("visit-machine-expanded.png")
  })
})
