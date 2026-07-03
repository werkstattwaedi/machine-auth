// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Self-service badge purchase at the kiosk, end-to-end through the
 * Functions emulator:
 *
 *  1. An unassigned (pre-personalized, no tokens doc) badge tapped with no
 *     session → the sign-in-first notice; the voucher is parked.
 *  2. The visitor then identifies with their own registered badge → the
 *     parked purchase offer resumes WITHOUT a re-tap, priced server-side
 *     (the seeded NFC user already owns a badge → CHF 5, not gratis).
 *  3. Confirming adds the line item; closing the checkout associates the
 *     badge: `tokens/{uid}` exists with the buyer's ref and the purchase
 *     tap's SDM counter.
 */

import { test, expect } from "@playwright/test"
import { FieldValue } from "firebase-admin/firestore"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { clearCollections, getAdminFirestore } from "./helpers"
import {
  NFC_TAG_UID,
  NFC_USER_ID,
  UNASSIGNED_TAG_UID,
} from "./global-setup"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readE2eData(): {
  picc: string
  cmac: string
  piccUnassigned: string
  cmacUnassigned: string
} {
  const dataPath = path.resolve(__dirname, ".e2e-data.json")
  return JSON.parse(readFileSync(dataPath, "utf-8"))
}

test.beforeEach(async () => {
  await clearCollections("checkouts")
  const db = getAdminFirestore()
  // Registered badge: reset the replay counter (each project re-runs with
  // the same counter-0 tap URL). Unassigned badge: delete any association a
  // prior run created so it is unassigned again.
  await db
    .collection("tokens")
    .doc(NFC_TAG_UID)
    .update({ lastSdmCounter: FieldValue.delete() })
  await db.collection("tokens").doc(UNASSIGNED_TAG_UID).delete()
})

test.describe("Self-service badge purchase", () => {
  test("unassigned tap without session shows the sign-in-first notice", async ({
    page,
  }) => {
    const { piccUnassigned, cmacUnassigned } = readE2eData()

    await page.goto(`/checkin?picc=${piccUnassigned}&cmac=${cmacUnassigned}`)

    await expect(page.getByTestId("badge-signin-first-dialog")).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText("Neuer Badge erkannt")).toBeVisible()
  })

  test("park → identify → buy → close associates the badge", async ({
    page,
  }) => {
    const { picc, cmac, piccUnassigned, cmacUnassigned } = readE2eData()

    // ── 1. Tap the unassigned badge first (anonymous): offer is parked ──
    await page.goto(`/checkin?picc=${piccUnassigned}&cmac=${cmacUnassigned}`)
    await expect(page.getByTestId("badge-signin-first-dialog")).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole("button", { name: "Verstanden" }).click()

    // ── 2. Identify with the registered badge: parked offer resumes ──
    // (sessionStorage carries the voucher across the reload.)
    await page.goto(`/checkin?picc=${picc}&cmac=${cmac}`)
    await expect(page.getByTestId("badge-purchase-dialog")).toBeVisible({
      timeout: 15_000,
    })
    // The NFC user already owns a badge → the new one costs the catalog
    // price, no gratis first-badge.
    await expect(page.getByTestId("badge-purchase-price")).toContainText("5")

    // ── 3. Confirm the purchase: line item lands in the open checkout ──
    await page.getByTestId("badge-purchase-confirm").click()
    await expect(page.getByTestId("badge-purchase-dialog")).not.toBeVisible({
      timeout: 15_000,
    })

    // Proceed: check-in → visit shows the badge block with the item.
    await page.getByRole("button", { name: "Weiter" }).click()
    await expect(page.getByTestId("badge-block")).toBeVisible({
      timeout: 15_000,
    })

    // ── 4. Close the checkout → association trigger fires ──
    await page.getByRole("button", { name: "Zum Checkout" }).click()
    await expect(page.getByText("Dein Besuch")).toBeVisible()
    await page.getByRole("button", { name: "Weiter zum Bezahlen" }).click()
    await expect(page.getByText("Zu bezahlen")).toBeVisible({
      timeout: 10_000,
    })

    // tokens/{uid} now exists with the buyer's ref + the tap's counter.
    const db = getAdminFirestore()
    await expect
      .poll(
        async () => {
          const token = await db
            .collection("tokens")
            .doc(UNASSIGNED_TAG_UID)
            .get()
          return token.exists ? token.get("userId")?.path : null
        },
        { timeout: 15_000 },
      )
      .toBe(`users/${NFC_USER_ID}`)

    const token = await db.collection("tokens").doc(UNASSIGNED_TAG_UID).get()
    expect(token.get("lastSdmCounter")).toBe(0)
    expect(String(token.get("label"))).toContain("Selbstkauf")
  })
})
