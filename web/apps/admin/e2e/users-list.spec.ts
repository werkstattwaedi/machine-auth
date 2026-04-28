// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { clearCollections, signInWithEmailCode } from "./helpers"
import {
  ADMIN_EMAIL,
  GRANT_TARGET_USER_ID,
  SEEDED_DIRECTORY_USERS,
} from "./global-setup"

test.describe("Admin user list + detail", () => {
  test.beforeEach(async () => {
    await clearCollections("loginCodes")
  })

  test("user list shows seeded users and supports drilldown", async ({
    page,
  }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.waitForURL((url) => url.pathname.startsWith("/users"))

    // Both seeded directory users are visible. We assert via an exact-name
    // role match so the admin/member rows don't satisfy the locator by
    // accident (those carry "Tester" as a last name).
    for (const u of SEEDED_DIRECTORY_USERS) {
      await expect(
        page.getByRole("link", {
          name: `${u.firstName} ${u.lastName}`.trim(),
        }),
      ).toBeVisible()
    }

    // Search input is rendered (filter behaviour is intentionally not asserted
    // here — see follow-up below). The presence check protects against the
    // toolbar disappearing.
    await expect(page.getByPlaceholder("Name suchen...")).toBeVisible()

    // Drill into the first directory user.
    await page.getByRole("link", { name: "Anna Architektin" }).click()
    await page.waitForURL((url) =>
      url.pathname.startsWith(`/users/${GRANT_TARGET_USER_ID}`),
    )

    // Detail page renders the user's name in the header.
    await expect(
      page.getByRole("heading", { name: /Anna Architektin/ }),
    ).toBeVisible()
    // Tabs scaffold is present.
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Tags" })).toBeVisible()
  })
})
