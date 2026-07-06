// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { clearCollections, signInWithEmailCode } from "./helpers"
import {
  ADMIN_EMAIL,
  GRANT_TARGET_USER_ID,
  SEEDED_DIRECTORY_USERS,
} from "./global-setup"

test.describe("Personen list + person page", () => {
  test.beforeEach(async () => {
    await clearCollections("loginCodes")
  })

  test("people list shows seeded users, filters by membership, drills down", async ({
    page,
  }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.waitForURL((url) => url.pathname.startsWith("/users"))

    // Both seeded directory users are visible.
    for (const u of SEEDED_DIRECTORY_USERS) {
      await expect(
        page.getByRole("link", {
          name: `${u.firstName} ${u.lastName}`.trim(),
          exact: true,
        }),
      ).toBeVisible()
    }

    await expect(page.getByPlaceholder("Name oder E-Mail …")).toBeVisible()

    // Membership filter: Anna + Bruno share the seeded family membership;
    // the signed-in Admin Tester has none and must disappear.
    await page.getByRole("button", { name: "Aktiv", exact: true }).click()
    await expect(
      page.getByRole("link", { name: "Anna Architektin", exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Admin Tester", exact: true }),
    ).not.toBeVisible()
    await page.getByRole("button", { name: "Alle", exact: true }).click()

    // Drill into the first directory user.
    await page
      .getByRole("link", { name: "Anna Architektin", exact: true })
      .first()
      .click()
    await page.waitForURL((url) =>
      url.pathname.startsWith(`/users/${GRANT_TARGET_USER_ID}`),
    )

    await expect(
      page.getByRole("heading", { name: /Anna Architektin/ }),
    ).toBeVisible()
    // Person workspace tabs.
    for (const tab of [
      "Übersicht",
      "Profil",
      "Mitgliedschaft",
      "Badges",
      "Berechtigungen",
    ]) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible()
    }
    // Übersicht surfaces the running visit.
    await expect(page.getByText("Aktiver Besuch läuft")).toBeVisible()
  })

  test("person overview deep-links into the person-filtered ledgers", async ({
    page,
  }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/users/${GRANT_TARGET_USER_ID}`)
    await expect(page.getByText("Aktiver Besuch läuft")).toBeVisible()

    // "in Rechnungen →" lands on the shared invoice list with the person
    // chip pre-applied.
    await page.getByRole("link", { name: /in Rechnungen/ }).click()
    await page.waitForURL((url) => url.pathname.startsWith("/invoices"))
    await expect(
      page.getByRole("button", { name: /Person: Anna Architektin/ }),
    ).toBeVisible()

    // Removing the chip widens to all invoices (chip disappears).
    await page
      .getByRole("button", { name: /Person: Anna Architektin/ })
      .click()
    await expect(
      page.getByRole("button", { name: /Person: Anna Architektin/ }),
    ).not.toBeVisible()
  })
})
