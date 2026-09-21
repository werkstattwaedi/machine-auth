// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for issue #394 — opening the material picker from a
 * workshop section that's scrolled down must NOT reset the page scroll to
 * the top. Previously, navigating from /visit to /visit/add/workshop/$id
 * (which mounts the picker Sheet) caused the underlying /visit page to jump
 * back to the top, so the member couldn't see items being added behind the
 * sheet.
 *
 * The fixture seeds an open checkout with several workshops visited so the
 * /visit page is tall enough to scroll. We scroll a lower section's "Material
 * hinzufügen" button into view, click it, wait for the picker to open, and
 * assert the page scroll position is preserved (not reset to 0).
 */

import { test, expect, type Page } from "@playwright/test"
import {
  clearCollections,
  getAdminFirestore,
  waitForLoginCode,
} from "./helpers"
import { AUTH_USER_EMAIL, AUTH_USER_ID } from "./global-setup"
import { FieldValue } from "firebase-admin/firestore"

const CHECKOUT_ID = "e2e-visit-scroll-checkout-001"

// Visit several workshops so the cost step renders enough sections to make
// the page scroll. makerspace is the last visible section, so its "Material
// hinzufügen" button only becomes reachable after scrolling down.
const VISITED = ["holz", "metall", "textil", "keramik", "makerspace"]

async function seedScrollFixture() {
  const db = getAdminFirestore()
  const userRef = db.collection("users").doc(AUTH_USER_ID)
  await db
    .collection("checkouts")
    .doc(CHECKOUT_ID)
    .set({
      userId: userRef,
      status: "open",
      usageType: "regular",
      created: FieldValue.serverTimestamp(),
      workshopsVisited: VISITED,
      persons: [],
    })
}

async function clearScrollFixture() {
  const db = getAdminFirestore()
  const checkoutRef = db.collection("checkouts").doc(CHECKOUT_ID)
  const items = await checkoutRef.collection("items").get()
  await Promise.all(items.docs.map((d) => d.ref.delete()))
  await checkoutRef.delete().catch(() => {})
}

async function signIn(page: Page) {
  await clearCollections("loginCodes")
  await page.goto("/login")
  await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
  await page.getByTestId("login-email-submit").click()
  await expect(page.getByTestId("login-code-stage")).toBeVisible({
    timeout: 5000,
  })
  const entry = await waitForLoginCode(AUTH_USER_EMAIL)
  expect(entry).toBeTruthy()
  await page.getByTestId("login-code-input").fill(entry!.code)
  await page.getByTestId("login-code-submit").click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 10_000,
  })
}

test.describe("Visit page — scroll preserved when opening picker (issue #394)", () => {
  test.beforeEach(async () => {
    await clearCollections("checkouts", "loginCodes")
    await clearScrollFixture()
    await seedScrollFixture()
  })

  test.afterEach(async () => {
    await clearScrollFixture()
  })

  test("opening the material picker does not reset page scroll", async ({
    page,
  }) => {
    await signIn(page)
    await page.goto("/visit")

    // Wait for the last visited section so we know the page is fully rendered.
    const block = page.getByTestId("workshop-block-makerspace")
    await expect(block).toBeVisible({ timeout: 10_000 })

    // The makerspace section's "Material hinzufügen" button lives near the
    // bottom of the page; scroll it into view so we have a non-zero scroll
    // offset before opening the picker.
    const addButton = block.getByRole("button", { name: "Material hinzufügen" })
    await addButton.scrollIntoViewIfNeeded()

    const scrollBefore = await page.evaluate(() => window.scrollY)
    expect(
      scrollBefore,
      "page must be scrolled down before opening the picker",
    ).toBeGreaterThan(50)

    await addButton.click()

    // Picker opened.
    await expect(page.getByPlaceholder("Material suchen…")).toBeVisible({
      timeout: 10_000,
    })

    // The underlying /visit page must not have jumped back to the top.
    // Allow a small tolerance for sub-pixel/scrollbar-lock differences.
    const scrollAfter = await page.evaluate(() => window.scrollY)
    expect(
      Math.abs(scrollAfter - scrollBefore),
      `scroll position must be preserved when the picker opens (was ${scrollBefore}, became ${scrollAfter})`,
    ).toBeLessThanOrEqual(5)

    // Settled-state check (issue #523): sample again well past all historical
    // re-assert windows. An early sample can pass while a late scroll-to-top
    // (router default or focus scrollIntoView) still lands afterwards — that
    // gap let CI's picker test pass while the later-sampling SLA screenshot
    // caught the background pinned at 0.
    await page.waitForTimeout(2000)
    const scrollSettled = await page.evaluate(() => window.scrollY)
    expect(
      Math.abs(scrollSettled - scrollBefore),
      `scroll position must stay preserved while the picker remains open (was ${scrollBefore}, settled at ${scrollSettled})`,
    ).toBeLessThanOrEqual(5)
  })

  // Issue #451: dismissing the sheet must NOT reset the /visit scroll either.
  // The open path is fixed by #394; this covers the close path, where
  // react-remove-scroll restores <body> overflow and would otherwise
  // collapse the page back to the top.
  test("closing the material picker does not reset page scroll", async ({
    page,
  }) => {
    await signIn(page)
    await page.goto("/visit")

    const block = page.getByTestId("workshop-block-makerspace")
    await expect(block).toBeVisible({ timeout: 10_000 })

    const addButton = block.getByRole("button", { name: "Material hinzufügen" })
    await addButton.scrollIntoViewIfNeeded()

    const scrollBefore = await page.evaluate(() => window.scrollY)
    expect(
      scrollBefore,
      "page must be scrolled down before opening the picker",
    ).toBeGreaterThan(50)

    await addButton.click()

    // Picker opened.
    const search = page.getByPlaceholder("Material suchen…")
    await expect(search).toBeVisible({ timeout: 10_000 })

    // Close the sheet via its close button (navigates back to /visit).
    await page.getByRole("button", { name: "Schliessen" }).click()

    // Sheet dismissed — wait for the search field to disappear.
    await expect(search).toBeHidden({ timeout: 10_000 })

    // Give the close-path re-assert loop time to outlast both the
    // scroll-lock overflow-restore reflow and the router's later
    // scroll-to-top of the navigated-to /visit page before sampling.
    await page.waitForTimeout(2000)

    // The /visit page must not have jumped back to the top on close.
    const scrollAfter = await page.evaluate(() => window.scrollY)
    expect(
      Math.abs(scrollAfter - scrollBefore),
      `scroll position must be preserved when the picker closes (was ${scrollBefore}, became ${scrollAfter})`,
    ).toBeLessThanOrEqual(5)
  })
})

// Issue #631: narrowing the search while the picker list is scrolled down
// left the list at its old offset. With only a few matches followed by the
// always-present ad-hoc rows, that offset showed nothing but ad-hoc rows —
// the actual match sat above the visible area. A changed query must bring
// the list back to the top.
const SEARCH_WORKSHOP = "stein"
const SEARCH_FILLER_COUNT = 30
const SEARCH_FILLER_IDS = Array.from(
  { length: SEARCH_FILLER_COUNT },
  (_, i) => `e2e-scroll-filler-${String(i).padStart(2, "0")}`,
)
const SEARCH_MATCH_ID = "e2e-scroll-match"

function searchCatalogDoc(code: string, name: string) {
  return {
    code,
    name,
    workshops: [SEARCH_WORKSHOP],
    category: [],
    active: true,
    userCanAdd: true,
    variants: [
      {
        id: "default",
        pricingModel: "count",
        unitPrice: { default: 1, member: 1 },
      },
    ],
  }
}

async function seedSearchCatalog() {
  const db = getAdminFirestore()
  const batch = db.batch()
  SEARCH_FILLER_IDS.forEach((id, i) => {
    batch.set(
      db.collection("catalog").doc(id),
      searchCatalogDoc(String(8100 + i), `Füllmaterial ${String(i).padStart(2, "0")}`),
    )
  })
  // Sorts after every filler, so it is off-screen in the unfiltered list.
  batch.set(
    db.collection("catalog").doc(SEARCH_MATCH_ID),
    searchCatalogDoc("8199", "Schlüsselring"),
  )
  await batch.commit()
}

async function clearSearchCatalog() {
  const db = getAdminFirestore()
  const batch = db.batch()
  for (const id of [...SEARCH_FILLER_IDS, SEARCH_MATCH_ID]) {
    batch.delete(db.collection("catalog").doc(id))
  }
  await batch.commit()
}

test.describe("Material picker — list scroll resets on search (issue #631)", () => {
  test.beforeEach(async () => {
    await clearCollections("checkouts", "loginCodes")
    await clearScrollFixture()
    await seedScrollFixture()
    await seedSearchCatalog()
  })

  test.afterEach(async () => {
    await clearSearchCatalog()
    await clearScrollFixture()
  })

  test("typing a query scrolls the list back to the matches", async ({
    page,
  }) => {
    await signIn(page)
    // A short viewport stands in for the on-screen keyboard: the report came
    // from a phone, where the keyboard leaves room for only a few rows, so
    // even "1 match + ad-hoc rows" overflows the list.
    const viewport = page.viewportSize()!
    await page.setViewportSize({ width: viewport.width, height: 360 })
    await page.goto(`/visit/add/workshop/${SEARCH_WORKSHOP}`)

    const search = page.getByPlaceholder("Material suchen…")
    await expect(search).toBeVisible({ timeout: 10_000 })

    const list = page.getByTestId("picker-list")
    const lastFiller = list.getByText(
      `Füllmaterial ${String(SEARCH_FILLER_COUNT - 1).padStart(2, "0")}`,
    )
    await expect(lastFiller).toBeVisible({ timeout: 10_000 })

    // Scroll down "a bit", as a member browsing would. The offset stays
    // valid for the filtered list (it is still taller than the viewport), so
    // the browser's own clamping does not rescue the match.
    await list.evaluate((el) => {
      el.scrollTop = 150
    })
    expect(
      await list.evaluate((el) => el.scrollTop),
      "list must be scrolled down before searching",
    ).toBeGreaterThan(50)

    await search.pressSequentially("schl")

    await expect(list.getByText("Schlüsselring")).toBeInViewport()
    expect(await list.evaluate((el) => el.scrollTop)).toBe(0)
  })
})
