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

interface GrantShape {
  source?: string
  grantedBy?: { id: string } | null
}

/** The grant map (#843), keyed by permission id. */
async function readGrants(userId: string): Promise<Record<string, GrantShape>> {
  const db = getAdminFirestore()
  const snap = await db.collection("users").doc(userId).get()
  return (snap.data()?.permissions ?? {}) as Record<string, GrantShape>
}

async function readUserPermissions(userId: string): Promise<string[]> {
  return Object.keys(await readGrants(userId))
}

test.describe("Berechtigungen tab: grant and revoke", () => {
  test.beforeEach(async () => {
    await clearCollections("loginCodes")
    // Reset the grant target user back to "no `fraese`" so tests are
    // independent of run order. `update`, not a merge-set: a merge would
    // keep the map's existing keys.
    const db = getAdminFirestore()
    await db
      .collection("users")
      .doc(GRANT_TARGET_USER_ID)
      .update({ permissions: {} })
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
    // Granted through the server, which records who granted it (ADM-16).
    const grant = (await readGrants(GRANT_TARGET_USER_ID))[GRANTABLE_PERMISSION_ID]
    expect(grant.source).toBe("admin")
    expect(grant.grantedBy?.id).toBeTruthy()
  })

  test("admin revokes a permission from its card", async ({ page }) => {
    // Pre-grant via the Admin SDK so the revoke flow has something to
    // remove and we don't depend on the previous spec running.
    const db = getAdminFirestore()
    await db
      .collection("users")
      .doc(GRANT_TARGET_USER_ID)
      .update({
        [`permissions.${GRANTABLE_PERMISSION_ID}`]: {
          permission: db.doc(`permission/${GRANTABLE_PERMISSION_ID}`),
          grantedAt: null,
          grantedBy: null,
          source: "legacy",
        },
      })

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
