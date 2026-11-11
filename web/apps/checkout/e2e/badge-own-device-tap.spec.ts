// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { FieldValue } from "firebase-admin/firestore"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { getAdminFirestore } from "./helpers"
import { NFC_TAG_UID } from "./global-setup"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readTap(): { picc: string; cmac: string } {
  const dataPath = path.resolve(__dirname, ".e2e-data.json")
  return JSON.parse(readFileSync(dataPath, "utf-8"))
}

// A badge read by a phone (#602): only the kiosk can turn a tap into a
// session, so the tap must never reach the server — it would be refused and
// would use up the tap — and the person lands on the sign-in page instead.
test("a badge tapped outside the kiosk leads to the sign-in page", async ({
  page,
}) => {
  const { picc, cmac } = readTap()
  // Other specs tap this badge; start from a counter nobody has used.
  const tokenRef = getAdminFirestore().doc(`tokens/${NFC_TAG_UID}`)
  await tokenRef.update({ lastSdmCounter: FieldValue.delete() })
  const tagCalls: string[] = []
  page.on("request", (request) => {
    if (request.postData()?.includes("verifyTagCheckout")) {
      tagCalls.push(request.url())
    }
  })

  await page.goto(`/?picc=${picc}&cmac=${cmac}`)

  await expect(page).toHaveURL(/\/login\?from=badge$/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Anmelden")
  await expect(page.getByRole("note")).toBeVisible()
  expect(tagCalls).toEqual([])

  // Nothing consumed the tap: the badge's read counter is untouched.
  expect((await tokenRef.get()).get("lastSdmCounter")).toBeUndefined()
})
