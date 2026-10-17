// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #605: saved persons. An identified person keeps a typed-in
 * companion for next time ("Für nächstes Mal speichern"), picks them from
 * "Person hinzufügen" on a later visit, and can stop suggesting them. The
 * checkout line records which saved person it is (CHK-11) — also on the
 * kiosk, where "Besuch starten" persists the roster before the terminal
 * resets.
 */

import { test, expect, type Page } from "@playwright/test"
import { FieldValue } from "firebase-admin/firestore"
import {
  clearCheckoutsDeep,
  clearCollections,
  clearSavedPersons,
  getAdminFirestore,
  getCheckoutDocs,
  getSavedPersons,
  installFakeKioskBridge,
  KIOSK_DESKTOP_ONLY,
  seedSavedPerson,
  waitForLoginCode,
} from "./helpers"
import { NFC_TAG_UID, NFC_USER_ID } from "./global-setup"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const AUTH_USER_EMAIL = "e2e-test@werkstattwaedi.ch"
const __dirname = path.dirname(fileURLToPath(import.meta.url))

type CheckoutPersonRow = { name: string; savedPersonId?: string; usageType?: string }

async function signIn(page: Page) {
  // Drop prior loginCodes so the per-email 60 s rate limit doesn't reject
  // back-to-back tests.
  await clearCollections("loginCodes")
  await page.goto("/login")
  await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
  await page.getByTestId("login-email-submit").click()
  await expect(page.getByTestId("login-code-stage")).toBeVisible({ timeout: 5000 })
  const entry = await waitForLoginCode(AUTH_USER_EMAIL)
  expect(entry).toBeTruthy()
  await page.getByTestId("login-code-input").fill(entry!.code)
  await page.getByTestId("login-code-submit").click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 })
}

/** Type a companion into the (single) person card and tick "save". */
async function typeCompanion(page: Page, first: string, last: string) {
  const card = page.getByTestId("person-card")
  await card.locator('label:has-text("Vorname")').locator("..").locator("input").fill(first)
  await card.locator('label:has-text("Nachname")').locator("..").locator("input").fill(last)
  await card.getByText("Kind (u. 18)").click()
  await card.getByRole("checkbox", { name: /Für nächstes Mal speichern/ }).click()
}

async function openCheckoutPersons(): Promise<CheckoutPersonRow[]> {
  const open = (await getCheckoutDocs()).filter(
    (c) => (c as Record<string, unknown>).status === "open",
  ) as Record<string, unknown>[]
  expect(open).toHaveLength(1)
  return open[0].persons as CheckoutPersonRow[]
}

test.describe("Saved persons — signed in (#605)", () => {
  const uid = process.env.E2E_AUTH_USER_UID

  test.beforeEach(async () => {
    test.skip(!uid, "E2E_AUTH_USER_UID not set (global-setup did not run)")
    await clearCheckoutsDeep()
    await clearSavedPersons(uid!)
  })

  // Saved persons outlive visits; other specs expect a plain button.
  test.afterEach(async () => {
    if (uid) await clearSavedPersons(uid)
    await clearCheckoutsDeep()
  })

  test("visit 1 saves a companion; visit 2 picks it and removes another", async ({ page }) => {
    const ruthId = await seedSavedPerson(uid!, {
      firstName: "Ruth",
      lastName: "Meier",
      userType: "erwachsen",
    })

    // ── Visit 1: a new companion, kept for next time ──
    await signIn(page)
    await page.goto("/")
    await expect(page.getByTestId("identity-strip").first()).toBeVisible({ timeout: 10_000 })
    await page.getByRole("button", { name: /Person hinzufügen/ }).click()
    await page.getByRole("menuitem", { name: /Neue Person/ }).click()
    await typeCompanion(page, "Noah", "Keller")
    await page.getByRole("button", { name: "Weiter" }).click()
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()

    await expect
      .poll(async () => (await getSavedPersons(uid!)).map((s) => s.firstName))
      .toEqual(["Noah", "Ruth"])
    const noah = (await getSavedPersons(uid!)).find((s) => s.firstName === "Noah")!
    expect(noah).toMatchObject({ lastName: "Keller", userType: "kind" })
    // Name + user type only — never the usage type.
    expect("usageType" in noah).toBe(false)
    // Saved before the roster was persisted: the line records it.
    await expect
      .poll(async () => (await openCheckoutPersons())[1]?.savedPersonId)
      .toBe(noah.id)

    // ── Visit 2 (fresh day): pick Noah, stop suggesting Ruth ──
    await clearCheckoutsDeep()
    await page.goto("/")
    await expect(page.getByTestId("identity-strip").first()).toBeVisible({ timeout: 10_000 })
    await page.getByRole("button", { name: /Person hinzufügen/ }).click()
    await expect(page.getByRole("menuitem", { name: "Noah Keller", exact: true })).toBeVisible()

    await page.getByRole("menuitem", { name: "Ruth Meier nicht mehr vorschlagen" }).click()
    await expect(page.getByTestId("saved-person-confirm")).toBeVisible()
    await page.getByRole("menuitem", { name: "Entfernen" }).click()
    await expect
      .poll(async () => (await getSavedPersons(uid!)).map((s) => s.id))
      .not.toContain(ruthId)
    await expect(page.getByRole("menuitem", { name: "Ruth Meier", exact: true })).toBeHidden()

    await page.getByRole("menuitem", { name: "Noah Keller", exact: true }).click()
    // The saved person joins as a strip; nothing to type, nothing to save.
    await expect(page.getByTestId("identity-strip")).toHaveCount(2)
    await expect(page.getByTestId("person-card")).toHaveCount(0)

    await page.getByRole("button", { name: "Weiter" }).click()
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()
    await expect
      .poll(async () => (await openCheckoutPersons()).map((p) => p.savedPersonId ?? null))
      .toEqual([null, noah.id])
    // Not saved twice.
    expect((await getSavedPersons(uid!)).map((s) => s.firstName)).toEqual(["Noah"])
  })
})

test.describe("Saved persons — kiosk badge (#605)", () => {
  test.beforeEach(async () => {
    await clearCollections("checkouts")
    await clearSavedPersons(NFC_USER_ID)
    // The seeded picc encodes counter=0; reset the replay defense so each
    // project's run can tap again.
    await getAdminFirestore()
      .collection("tokens")
      .doc(NFC_TAG_UID)
      .update({ lastSdmCounter: FieldValue.delete() })
  })

  test.afterEach(async () => {
    await clearSavedPersons(NFC_USER_ID)
    await clearCollections("checkouts")
  })

  test("Besuch starten saves the companion and links the line", async ({ page, isMobile }) => {
    test.skip(isMobile, KIOSK_DESKTOP_ONLY)
    const { picc, cmac } = JSON.parse(
      readFileSync(path.resolve(__dirname, ".e2e-data.json"), "utf-8"),
    ) as { picc: string; cmac: string }
    await installFakeKioskBridge(page)
    await page.goto(`/checkin?kiosk=&picc=${picc}&cmac=${cmac}`)
    await expect(page.getByTestId("checkin-start-visit")).toHaveAttribute(
      "data-countdown",
      "running",
      { timeout: 15_000 },
    )

    // Adding a person is a touch: the countdown stops.
    await page.getByRole("button", { name: /Person hinzufügen/ }).click()
    await expect(page.getByTestId("checkin-start-visit")).not.toHaveAttribute(
      "data-countdown",
      "running",
    )
    await typeCompanion(page, "Lea", "Tester")
    await page.getByTestId("checkin-start-visit").click()

    // The kiosk resets to the start screen.
    await expect(page.getByTestId("checkin-seg-account")).toBeVisible({ timeout: 15_000 })

    const saved = await getSavedPersons(NFC_USER_ID)
    expect(saved.map((s) => [s.firstName, s.lastName, s.userType])).toEqual([
      ["Lea", "Tester", "kind"],
    ])
    // The visit is closed elsewhere later: the link must already be on it.
    const persons = await openCheckoutPersons()
    expect(persons.map((p) => p.savedPersonId ?? null)).toEqual([null, saved[0].id])
  })
})
