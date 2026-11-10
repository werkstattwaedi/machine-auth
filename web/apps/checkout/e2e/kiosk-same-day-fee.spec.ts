// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Same-day fee at the kiosk for a checkout forgotten open (#854, CHK-37,
 * CHK-39): someone came twice last Monday, paid the first visit and left the
 * second open; a week later a badge tap brings it up at the kiosk. Check Out
 * must show the usage fee as already paid that day — the badge session gets
 * last Monday's visits from `getSameDayVisits`, since the rules hold it to
 * the visits of the last two days.
 */

import { test, expect } from "@playwright/test"
import { FieldValue, Timestamp } from "firebase-admin/firestore"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { clearCollections, getAdminFirestore } from "./helpers"
import { NFC_TAG_UID, NFC_USER_ID } from "./global-setup"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readE2eData(): { picc: string; cmac: string } {
  const dataPath = path.resolve(__dirname, ".e2e-data.json")
  return JSON.parse(readFileSync(dataPath, "utf-8"))
}

// Last week, 10:00 / 12:00 / 14:00 Zurich time — one business day.
const LAST_WEEK = new Date(Date.now() - 7 * 24 * 3600 * 1000)
LAST_WEEK.setUTCHours(8, 0, 0, 0)
const at = (hours: number) =>
  Timestamp.fromMillis(LAST_WEEK.getTime() + hours * 3600 * 1000)

test.beforeEach(async () => {
  await clearCollections("checkouts")
  await getAdminFirestore()
    .collection("tokens")
    .doc(NFC_TAG_UID)
    .update({ lastSdmCounter: FieldValue.delete() })
})

test("a badge tap on last week's forgotten second visit shows the fee as paid", async ({
  page,
}) => {
  const db = getAdminFirestore()
  const owner = db.doc(`users/${NFC_USER_ID}`)
  const ownerLine = {
    name: "NFC Tester",
    email: "nfc@test.com",
    userType: "erwachsen",
    userRef: owner,
    usageType: "regular",
  }
  await db.collection("checkouts").doc("e2e-monday-paid").set({
    userId: owner,
    status: "closed",
    usageType: "regular",
    created: at(0),
    closedAt: at(2),
    workshopsVisited: ["holz"],
    persons: [ownerLine],
  })
  await db.collection("checkouts").doc("e2e-monday-forgotten").set({
    userId: owner,
    status: "open",
    usageType: "regular",
    created: at(4),
    workshopsVisited: ["holz"],
    persons: [ownerLine],
    modifiedBy: NFC_USER_ID,
    modifiedAt: at(4),
  })

  const { picc, cmac } = readE2eData()
  await page.goto(`/checkin?kiosk&picc=${picc}&cmac=${cmac}`)

  // A checkout from an earlier day lands on Check Out (KIO-1).
  await expect(page.getByText("heute bereits abgerechnet").first()).toBeVisible({
    timeout: 15_000,
  })
})
