// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { clearCollections, signInWithEmailCode } from "./helpers"
import { ADMIN_EMAIL, MACHINE_LASER_ID, VISIT_CLOSED_ID } from "./global-setup"

test.describe("Besuche + Nutzungen ledgers", () => {
  test.beforeEach(async () => {
    await clearCollections("loginCodes")
  })

  test("visits list filters by status and opens the visit detail", async ({
    page,
  }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto("/visits")

    // Seeded: one open, one billed visit for Anna.
    await expect(page.getByText("offen", { exact: true })).toBeVisible()
    await expect(page.getByText("abgerechnet", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Offen", exact: true }).click()
    await expect(page.getByText("abgerechnet", { exact: true })).not.toBeVisible()
    await page.getByRole("button", { name: "Alle", exact: true }).click()

    await expect(page).toHaveScreenshot("visits-list.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    })

    // Open the billed visit: line items + link to its Rechnung.
    await page.goto(`/visits/${VISIT_CLOSED_ID}`)
    await expect(page.getByText("Lasercutter Nutzung")).toBeVisible()
    await expect(page.getByText("Ahorn 30 mm")).toBeVisible()
    await expect(
      page.getByRole("link", { name: /Rechnung öffnen/ }),
    ).toBeVisible()

    await expect(page).toHaveScreenshot("visit-detail.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    })
  })

  test("usages list deep-links by machine and into the Besuch", async ({
    page,
  }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/usages?machine=${MACHINE_LASER_ID}`)

    // Machine chip pre-applied; both seeded usages are on the laser.
    await expect(
      page.getByRole("button", { name: /Maschine: Lasercutter/ }),
    ).toBeVisible()
    await expect(page.getByText("1h 20m")).toBeVisible()
    await expect(page.getByText("40m", { exact: true })).toBeVisible()

    await expect(page).toHaveScreenshot("usages-list.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    })

    // The billed usage links to its Besuch.
    await page.getByRole("link", { name: "Besuch", exact: true }).click()
    await page.waitForURL((url) =>
      url.pathname.startsWith(`/visits/${VISIT_CLOSED_ID}`),
    )
    await expect(page.getByText("Lasercutter Nutzung")).toBeVisible()
  })
})
