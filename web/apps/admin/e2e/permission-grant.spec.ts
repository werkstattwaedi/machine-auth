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
  // Admin SDK DocumentReference also exposes `path`; we accept either.
  path?: string
}

async function readUserPermissions(userId: string): Promise<string[]> {
  const db = getAdminFirestore()
  const snap = await db.collection("users").doc(userId).get()
  const data = snap.data() ?? {}
  const refs = (data.permissions ?? []) as PermissionRefShape[]
  return refs.map((p) => p.id)
}

test.describe("Admin grants and revokes a permission", () => {
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

  test("admin can grant a permission and Firestore reflects it", async ({
    page,
  }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/users/${GRANT_TARGET_USER_ID}`)
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible()

    // Sanity: target permission badge is present and currently NOT selected
    // (outline variant). We locate by visible label text.
    const grantBadge = page.getByText(GRANTABLE_PERMISSION_NAME, {
      exact: true,
    })
    await expect(grantBadge).toBeVisible()

    // Toggle it on.
    await grantBadge.click()

    // Save.
    await page.getByRole("button", { name: "Speichern" }).click()

    // Wait for Firestore to reflect the new permission. Polls because the
    // mutation hook fires asynchronously and we want the assertion not the
    // mere absence of an error toast.
    await expect
      .poll(() => readUserPermissions(GRANT_TARGET_USER_ID), {
        timeout: 5000,
        message: `permissions on ${GRANT_TARGET_USER_ID} should include ${GRANTABLE_PERMISSION_ID}`,
      })
      .toContain(GRANTABLE_PERMISSION_ID)
  })

  test("admin can revoke a previously granted permission", async ({
    page,
  }) => {
    // Pre-grant the permission via the Admin SDK so the revoke flow has
    // something to remove and we don't depend on the previous spec running.
    const db = getAdminFirestore()
    await db
      .collection("users")
      .doc(GRANT_TARGET_USER_ID)
      .set(
        {
          permissions: [db.doc(`permission/${GRANTABLE_PERMISSION_ID}`)],
        },
        { merge: true },
      )

    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/users/${GRANT_TARGET_USER_ID}`)
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible()

    // Click the same badge — it's currently selected, so this toggles off.
    await page.getByText(GRANTABLE_PERMISSION_NAME, { exact: true }).click()

    await page.getByRole("button", { name: "Speichern" }).click()

    await expect
      .poll(() => readUserPermissions(GRANT_TARGET_USER_ID), {
        timeout: 5000,
        message: `permissions on ${GRANT_TARGET_USER_ID} should no longer include ${GRANTABLE_PERMISSION_ID}`,
      })
      .not.toContain(GRANTABLE_PERMISSION_ID)
  })
})
