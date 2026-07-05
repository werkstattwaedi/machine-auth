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
  MACHINE_CNC_ID,
  MACHINE_LASER_ID,
  OPEN_REPORT_MESSAGE,
} from "./global-setup"

test.describe("Maschinen workspace", () => {
  test.beforeEach(async () => {
    await clearCollections("loginCodes")
    // Reset machine + report state mutated by the flows below.
    const db = getAdminFirestore()
    await db
      .collection("machine")
      .doc(MACHINE_LASER_ID)
      .set({ blocked: null }, { merge: true })
    await db
      .collection("machine_reports")
      .doc("e2e-report-1")
      .set({ status: "open", resolvedAt: null }, { merge: true })
  })

  test("machine list shows status, reports and screenshot", async ({
    page,
  }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto("/machines")

    // Seeded CNC is blocked, laser free with one open Meldung.
    const cncRow = page.getByRole("row", { name: /CNC Fräse/ })
    await expect(cncRow.getByText("gesperrt")).toBeVisible()
    const laserRow = page.getByRole("row", { name: /Lasercutter/ })
    await expect(laserRow.getByText("frei")).toBeVisible()
    await expect(laserRow.getByText("1", { exact: true })).toBeVisible()

    // Status filter pills narrow the list.
    await page.getByRole("button", { name: "Gesperrt", exact: true }).click()
    await expect(page.getByRole("row", { name: /CNC Fräse/ })).toBeVisible()
    await expect(
      page.getByRole("row", { name: /Lasercutter/ }),
    ).not.toBeVisible()
    await page.getByRole("button", { name: "Alle", exact: true }).click()

    await expect(page).toHaveScreenshot("machines-list.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    })
  })

  test("blocked machine page shows reason; admin can release", async ({
    page,
  }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/machines/${MACHINE_CNC_ID}`)

    await expect(page.getByText(/Gesperrt — Problem/)).toBeVisible()
    await expect(page.getByText(/Spindel macht Geräusche/)).toBeVisible()
    await expect(page.getByText(/durch Admin Tester/)).toBeVisible()

    await expect(page).toHaveScreenshot("machine-blocked.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    })

    // Release, then re-block so the seed state survives for other specs.
    await page.getByRole("button", { name: "Freigeben" }).first().click()
    await expect(page.getByText("frei", { exact: true })).toBeVisible()

    const db = getAdminFirestore()
    await db
      .collection("machine")
      .doc(MACHINE_CNC_ID)
      .set(
        {
          blocked: {
            kind: "problem",
            note: "Spindel macht Geräusche, bis Techniker geprüft hat nicht benutzen.",
            byName: "Admin Tester",
            at: new Date("2026-06-28T10:00:00Z"),
          },
        },
        { merge: true },
      )
  })

  test("admin blocks a machine with reason + note", async ({ page }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/machines/${MACHINE_LASER_ID}`)
    await expect(page.getByText("frei", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Sperren" }).click()
    await page.getByRole("button", { name: "Wartung" }).click()
    await page
      .getByLabel("Notiz")
      .fill("Jahreswartung — Optik reinigen und Achsen schmieren.")
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sperren" })
      .click()

    // Wait for the dialog to unmount (Radix keeps it in the DOM through
    // the close animation) so its "Wartung" segment button can't collide
    // with the status-badge assertion below.
    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(page.getByText("Wartung", { exact: true })).toBeVisible()
    // Match the quoted note paragraph, not a dialog textarea holding the
    // same text.
    await expect(page.getByText(/„Jahreswartung/)).toBeVisible()

    // Firestore reflects the block. Poll: the UI renders the web SDK's
    // optimistic write immediately, the server commit lands a beat later.
    const db = getAdminFirestore()
    await expect
      .poll(async () => {
        const snap = await db.collection("machine").doc(MACHINE_LASER_ID).get()
        return snap.data()?.blocked?.kind ?? null
      })
      .toBe("maintenance")
  })

  test("Meldungen tab lists user reports and marks them done", async ({
    page,
  }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/machines/${MACHINE_LASER_ID}?tab=reports`)

    await expect(page.getByText(OPEN_REPORT_MESSAGE)).toBeVisible()
    await expect(page.getByText(/Anna Architektin/)).toBeVisible()

    await expect(page).toHaveScreenshot("machine-reports.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    })

    await page.getByRole("button", { name: "Erledigt" }).click()
    await expect(page.getByText("erledigt", { exact: true })).toBeVisible()

    const db = getAdminFirestore()
    const snap = await db
      .collection("machine_reports")
      .doc("e2e-report-1")
      .get()
    expect(snap.data()?.status).toBe("done")
  })
})
