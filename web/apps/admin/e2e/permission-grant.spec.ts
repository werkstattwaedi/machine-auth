// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import {
  clearCollections,
  getAdminFirestore,
  signInWithEmailCode,
} from "./helpers"
import {
  ADMIN_EMAIL,
  GRANTABLE_PERMISSION_ID,
  GRANTABLE_PERMISSION_NAME,
  GRANT_TARGET_USER_ID,
} from "./global-setup"

interface PermissionRefShape {
  id: string
  path?: string
}

async function readUserPermissions(userId: string): Promise<string[]> {
  const db = getAdminFirestore()
  const snap = await db.collection("users").doc(userId).get()
  const data = snap.data() ?? {}
  const refs = (data.permissions ?? []) as PermissionRefShape[]
  return refs.map((p) => p.id)
}

test.describe("Berechtigungen tab: grant and revoke", () => {
  test.beforeEach(async () => {
    await clearCollections("loginCodes")
    // Reset the grant target user back to "no `fraese`" so tests are
    // independent of run order.
    const db = getAdminFirestore()
    await db
      .collection("users")
      .doc(GRANT_TARGET_USER_ID)
      .set({ permissions: [] }, { merge: true })
  })

  test("admin grants a permission via the picker", async ({ page }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/users/${GRANT_TARGET_USER_ID}?tab=permissions`)

    // Pick the grantable permission in the select…
    await page.getByRole("combobox").click()
    await page
      .getByRole("option", { name: GRANTABLE_PERMISSION_NAME })
      .click()
    // …and grant it.
    await page.getByRole("button", { name: "Erteilen" }).click()

    // A permission card appears with revoke right there.
    await expect(page.getByText(GRANTABLE_PERMISSION_NAME)).toBeVisible()
    await expect(page.getByRole("button", { name: "Entziehen" })).toBeVisible()

    await expect
      .poll(() => readUserPermissions(GRANT_TARGET_USER_ID), {
        timeout: 5000,
        message: `permissions on ${GRANT_TARGET_USER_ID} should include ${GRANTABLE_PERMISSION_ID}`,
      })
      .toContain(GRANTABLE_PERMISSION_ID)
  })

  test("admin revokes a permission from its card", async ({ page }) => {
    // Pre-grant via the Admin SDK so the revoke flow has something to
    // remove and we don't depend on the previous spec running.
    const db = getAdminFirestore()
    await db
      .collection("users")
      .doc(GRANT_TARGET_USER_ID)
      .set(
        { permissions: [db.doc(`permission/${GRANTABLE_PERMISSION_ID}`)] },
        { merge: true },
      )

    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/users/${GRANT_TARGET_USER_ID}?tab=permissions`)

    await expect(page.getByText(GRANTABLE_PERMISSION_NAME)).toBeVisible()
    await page.getByRole("button", { name: "Entziehen" }).click()

    await expect
      .poll(() => readUserPermissions(GRANT_TARGET_USER_ID), {
        timeout: 5000,
        message: `permissions on ${GRANT_TARGET_USER_ID} should no longer include ${GRANTABLE_PERMISSION_ID}`,
      })
      .not.toContain(GRANTABLE_PERMISSION_ID)
  })
})
