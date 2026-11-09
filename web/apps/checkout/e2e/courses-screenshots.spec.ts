// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kursleitung (#842) against the emulator's edoobox stand-in
 * (`testing_edoobox/state`, functions/src/courses/edoobox_fake.ts). A course
 * leader account of its own, so no other spec's sidebar changes. edoobox
 * dates follow the real clock, so the date texts are masked.
 */

import { test, expect, type Page } from "@playwright/test"
import { FieldValue } from "firebase-admin/firestore"
import { clearCollections, getAdminAuth, getAdminFirestore, waitForLoginCode } from "./helpers"

const LEADER_EMAIL = "kursleitung.e2e@werkstattwaedi.ch"
const ANNA_EMAIL = "anna.kurs.e2e@werkstattwaedi.ch"
const ADMIN_ID = "admin_e2e"
const RUNNING = "offer_e2e_running"
const TO_CLOSE = "offer_e2e_close"
const DAY = 86400_000
const HOUR = 3600_000

const iso = (ms: number) => new Date(ms).toISOString()

async function seed(): Promise<{ leaderUid: string; annaUid: string }> {
  const db = getAdminFirestore()
  const auth = await getAdminAuth()
  const ensure = async (email: string, first: string, last: string, extra: Record<string, unknown> = {}) => {
    const user = await auth.getUserByEmail(email).catch(() => auth.createUser({ email }))
    await db.doc(`users/${user.uid}`).set({
      email,
      firstName: first,
      lastName: last,
      roles: [],
      permissions: {},
      userType: "erwachsen",
      termsAcceptedAt: FieldValue.serverTimestamp(),
      created: FieldValue.serverTimestamp(),
      billingAddress: null,
      ...extra,
    })
    return user.uid
  }
  const leaderUid = await ensure(LEADER_EMAIL, "Petra", "Keller", { edooboxLeaderId: ADMIN_ID })
  const annaUid = await ensure(ANNA_EMAIL, "Anna", "Brunner")
  const now = Date.now()
  const day = (offsetDays: number, hour: number) => {
    const d = new Date(now + offsetDays * DAY)
    d.setUTCHours(hour, 0, 0, 0)
    return d.getTime()
  }
  const people = [
    ["eu_anna", "Anna", "Brunner", ANNA_EMAIL],
    ["eu_luca", "Luca", "Meier", "luca.kurs.e2e@werkstattwaedi.ch"],
    ["eu_sofia", "Sofia", "Rossi", "sofia.kurs.e2e@werkstattwaedi.ch"],
  ] as const
  const state = {
    admins: [{ id: ADMIN_ID, firstName: "Petra", lastName: "Keller", email: LEADER_EMAIL, active: true }],
    offers: [
      { id: RUNNING, name: "Einführung Lasercutter", tags: ["Makerspace"] },
      { id: TO_CLOSE, name: "Einführung CNC-Fräse", tags: ["Metall"] },
    ],
    dates: [
      { id: "r1", offerId: RUNNING, start: iso(day(-3, 8)), end: iso(day(-3, 11)), leaders: [ADMIN_ID] },
      { id: "r2", offerId: RUNNING, start: iso(day(4, 8)), end: iso(day(4, 11)), leaders: [ADMIN_ID] },
      { id: "c1", offerId: TO_CLOSE, start: iso(day(-9, 8)), end: iso(day(-9, 11)), leaders: [ADMIN_ID] },
      { id: "c2", offerId: TO_CLOSE, start: iso(day(-2, 8)), end: iso(day(-2, 11)), leaders: [ADMIN_ID] },
    ],
    users: people.map(([id, firstName, lastName, email]) => ({ id, firstName, lastName, email })),
    bookings: [RUNNING, TO_CLOSE].flatMap((offerId) =>
      people.map(([id]) => ({ bookingId: `b_${offerId}_${id}`, offerId, ownerId: id, userIds: [id], cancelled: false, waitingList: false }))
    ),
    participants: [RUNNING, TO_CLOSE].flatMap((offerId) =>
      people.map(([id]) => ({ offerId, participantId: `p_${offerId}_${id}`, userId: id }))
    ),
    attendances: [
      { attendanceId: "a1", participantId: `p_${RUNNING}_eu_anna`, dateId: "r1", status: 1 },
      { attendanceId: "a2", participantId: `p_${RUNNING}_eu_sofia`, dateId: "r1", status: 3 },
      { attendanceId: "a3", participantId: `p_${TO_CLOSE}_eu_anna`, dateId: "c1", status: 1 },
      { attendanceId: "a4", participantId: `p_${TO_CLOSE}_eu_anna`, dateId: "c2", status: 2 },
      { attendanceId: "a5", participantId: `p_${TO_CLOSE}_eu_luca`, dateId: "c1", status: 1 },
      { attendanceId: "a6", participantId: `p_${TO_CLOSE}_eu_luca`, dateId: "c2", status: 4 },
    ],
    notes: [],
    failing: false,
  }
  await db.doc("testing_edoobox/state").set(state)
  const laser = db.doc("permission/laser")
  await db.doc(`courses/${RUNNING}`).set({ permission: laser, title: "Einführung Lasercutter" })
  await db.doc(`courses/${TO_CLOSE}`).set({ permission: laser, title: "Einführung CNC-Fräse" })
  for (const offerId of [RUNNING, TO_CLOSE]) {
    await db.doc(`courseLinks/${offerId}_p_${offerId}_eu_anna`).set({
      offerId,
      participantId: `p_${offerId}_eu_anna`,
      edooboxUserId: "eu_anna",
      user: db.doc(`users/${annaUid}`),
      choice: "temp",
      linkedBy: db.doc(`users/${leaderUid}`),
      linkedAt: FieldValue.serverTimestamp(),
      offerTitle: "Kurs",
      participantName: "Anna Brunner",
    })
  }
  return { leaderUid, annaUid }
}

async function signIn(page: Page) {
  await clearCollections("loginCodes")
  await page.goto("/login")
  await page.getByTestId("login-email-input").fill(LEADER_EMAIL)
  await page.getByTestId("login-email-submit").click()
  await expect(page.getByTestId("login-code-stage")).toBeVisible({ timeout: 5000 })
  const entry = await waitForLoginCode(LEADER_EMAIL)
  await page.getByTestId("login-code-input").fill(entry!.code)
  await page.getByTestId("login-code-submit").click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 })
}

/** Dates move with the clock: mask every text that shows one. */
const dateMasks = (page: Page) => [page.getByTestId("course-dates"), page.locator("thead tr:nth-child(2) th")]

test.describe.configure({ mode: "serial" })

test.describe("Kursleitung (#842)", () => {
  test.beforeEach(async () => {
    await seed()
  })

  test("list", async ({ page, isMobile }) => {
    await signIn(page)
    await page.goto("/account/courses")
    await expect(page.getByText("Einführung Lasercutter")).toBeVisible({ timeout: 15_000 })
    // The sidebar entry (CRS-1); on mobile it sits in the menu sheet.
    if (!isMobile) await expect(page.getByRole("link", { name: "Kursleitung" })).toBeVisible()
    await expect(page).toHaveScreenshot("courses-list.png", { mask: dateMasks(page) })
  })

  test("course page, and setting a Präsenzstatus", async ({ page }) => {
    await signIn(page)
    await page.goto(`/account/courses/${RUNNING}`)
    await expect(page.getByRole("heading", { name: "Teilnehmende" })).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveScreenshot("course-running.png", { mask: dateMasks(page) })

    await page.getByRole("button", { name: /^Luca Meier am .*: kein Status$/ }).click()
    await expect(page.getByRole("menuitemradio", { name: "Anwesend" })).toBeVisible()
    await expect(page).toHaveScreenshot("course-status-menu.png", { mask: dateMasks(page) })
    await page.getByRole("menuitemradio", { name: "Anwesend" }).click()
    await expect(page.getByText("In edoobox gespeichert")).toBeVisible()
    await expect
      .poll(async () => {
        const state = (await getAdminFirestore().doc("testing_edoobox/state").get()).data()!
        return state.attendances.some((a: { participantId: string; status: number }) => a.participantId === `p_${RUNNING}_eu_luca` && a.status === 1)
      })
      .toBe(true)
  })

  test("person pages", async ({ page }) => {
    await signIn(page)
    await page.goto(`/account/courses/${RUNNING}/p_${RUNNING}_eu_luca`)
    await expect(page.getByRole("button", { name: "Konto anlegen und verknüpfen" })).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveScreenshot("person-not-linked.png")
    await page.goto(`/account/courses/${RUNNING}/p_${RUNNING}_eu_anna`)
    await expect(page.getByRole("radiogroup", { name: /Berechtigung/ })).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveScreenshot("person-linked.png")
  })

  test("close page", async ({ page }) => {
    await signIn(page)
    await page.goto(`/account/courses/${TO_CLOSE}/close`)
    await expect(page.getByRole("heading", { name: "Kurs abschliessen" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("An 1 Termin abwesend")).toBeVisible()
    await expect(page).toHaveScreenshot("course-close.png")
  })
})
