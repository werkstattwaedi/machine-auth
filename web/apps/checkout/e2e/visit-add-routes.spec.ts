// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Coverage for the picker overlay sub-routes introduced in issue #213:
 *
 *   /visit/add                         — full catalog
 *   /visit/add/workshop/$workshopId    — workshop-scoped (replaces the
 *                                         old inline "+ Material" button)
 *   /visit/add/list/$listId            — pricelist QR target
 *   /visit/add/item/$code              — single-item QR target
 *
 * Each test signs in and deep-links into the route, then asserts the
 * picker overlay rendered with the right scope. The pricelist test
 * also covers the case where the catalog item attributes to a workshop
 * the user has not yet checked in to (overlap-first attribution).
 */

import { test, expect, type Page } from "@playwright/test"
import {
  clearCollections,
  getAdminFirestore,
  waitForLoginCode,
} from "./helpers"
import { AUTH_USER_EMAIL } from "./global-setup"
import { FieldValue } from "firebase-admin/firestore"

const PRICE_LIST_ID = "e2e-pricelist-1"

async function seedPriceList() {
  const db = getAdminFirestore()
  await db.collection("price_lists").doc(PRICE_LIST_ID).set({
    name: "E2E Preisliste",
    items: ["e2e-item-1", "e2e-item-2"],
    footer: "",
    active: true,
    modifiedAt: FieldValue.serverTimestamp(),
  })
}

async function clearPriceList() {
  const db = getAdminFirestore()
  await db
    .collection("price_lists")
    .doc(PRICE_LIST_ID)
    .delete()
    .catch(() => {})
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
  // After sign-in the / dispatcher forwards to /checkin (no open checkout).
  // Walk through /checkin so subsequent /visit/add/* deep-links don't
  // bounce back via useBounceIfNoCheckout — the wizard now persists a
  // persons roster + creates an open checkout doc on advance.
  await page.waitForURL((url) => url.pathname === "/checkin", {
    timeout: 10_000,
  })
  await page.getByRole("button", { name: "Weiter" }).click()
  await page.waitForURL((url) => url.pathname === "/visit", {
    timeout: 10_000,
  })
}

test.describe("Visit /add/* sub-routes (issue #213)", () => {
  test.beforeEach(async () => {
    await clearCollections("checkouts", "loginCodes")
    await clearPriceList()
    await seedPriceList()
  })

  test.afterEach(async () => {
    await clearPriceList()
  })

  test("/visit/add — opens the picker unfiltered", async ({ page }) => {
    await signIn(page)
    await page.goto("/visit/add")

    await expect(page.getByPlaceholder("Material suchen…")).toBeVisible({
      timeout: 10_000,
    })
    // E2E Testmaterial is from holz, Filament is from makerspace — both
    // visible in the unfiltered "all" scope.
    await expect(page.getByText("E2E Testmaterial")).toBeVisible()
    await expect(page.getByText(/^Filament$/)).toBeVisible()
  })

  test("/visit/add/workshop/holz — workshop scope only shows that workshop's items", async ({
    page,
  }) => {
    await signIn(page)
    await page.goto("/visit/add/workshop/holz")

    await expect(page.getByPlaceholder("Material suchen…")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText("E2E Testmaterial")).toBeVisible()
    // Filament lives on makerspace and must NOT appear here.
    await expect(page.getByText(/^Filament$/)).toHaveCount(0)
  })

  test("/visit/add/list/$id — pricelist scope shows only the listed items", async ({
    page,
  }) => {
    await signIn(page)
    await page.goto(`/visit/add/list/${PRICE_LIST_ID}`)

    await expect(page.getByPlaceholder("Material suchen…")).toBeVisible({
      timeout: 10_000,
    })
    // Pricelist contains e2e-item-1 (E2E Testmaterial) + e2e-item-2 (E2E
    // Holzplatte). Other catalog items must not appear.
    await expect(page.getByText("E2E Testmaterial")).toBeVisible()
    await expect(page.getByText("E2E Holzplatte")).toBeVisible()
    await expect(page.getByText(/^Filament$/)).toHaveCount(0)
    await expect(page.getByText(/^Schleifpapier$/)).toHaveCount(0)
  })

  test("/visit/add/item/$code — single-item scope auto-expands the form", async ({
    page,
  }) => {
    await signIn(page)
    // 9001 = E2E Testmaterial (area pricing model).
    await page.goto("/visit/add/item/9001")

    await expect(page.getByPlaceholder("Material suchen…")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText("E2E Testmaterial")).toBeVisible()
    // The area form renders length/width inputs (cm → m²); their presence
    // confirms the variant chooser auto-expanded to the form.
    await expect(page.getByRole("button", { name: "Hinzufügen" })).toBeVisible()
  })

  test("/visit/add/item/$code/$variantId — pre-selects the named variant", async ({
    page,
  }) => {
    await signIn(page)
    // 9200 = E2E Sperrholz, 2 variants: "default" (Per m²) and
    // "a3" (Zuschnitt A3, count pricing, derived from the variant registry). Targeting the
    // count variant means the form should show a Stück input, not the
    // length × width m² inputs of the default variant.
    await page.goto("/visit/add/item/9200/a3")

    await expect(page.getByPlaceholder("Material suchen…")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText("E2E Sperrholz")).toBeVisible()
    // The variant chooser (radiogroup) is visible for ≥ 2 variants;
    // "Zuschnitt A3" should be the active variant.
    const variantButton = page.getByRole("radio", { name: "Zuschnitt A3" })
    await expect(variantButton).toHaveAttribute("aria-checked", "true")
  })

  test("/visit/add/item/$code/$variantId — unknown variant falls back silently", async ({
    page,
  }) => {
    await signIn(page)
    await page.goto("/visit/add/item/9200/typo-variant")

    // Picker still mounts; the per-m² (default) variant is selected
    // because the unknown id fell back to variants[0].
    await expect(page.getByPlaceholder("Material suchen…")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText("E2E Sperrholz")).toBeVisible()
    const defaultVariant = page.getByRole("radio", { name: "Per m²" })
    await expect(defaultVariant).toHaveAttribute("aria-checked", "true")
  })

  test("/visit/add/item/$code — unknown code shows error", async ({ page }) => {
    await signIn(page)
    await page.goto("/visit/add/item/does-not-exist")

    await expect(page.getByText("Unbekannter Artikel")).toBeVisible({
      timeout: 10_000,
    })
  })

  test("close navigates back to /visit", async ({ page }) => {
    await signIn(page)
    await page.goto("/visit/add/workshop/holz")
    await expect(page.getByPlaceholder("Material suchen…")).toBeVisible({
      timeout: 10_000,
    })

    await page.getByRole("button", { name: "Schliessen" }).click()
    await page.waitForURL((url) => url.pathname === "/visit", {
      timeout: 5000,
    })
  })
})
