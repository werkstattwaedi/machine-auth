// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Issue #729: one header menu top right in every shell. Locks the open menu
// in the member area (dropdown on desktop, right-hand sheet with the
// navigation on mobile) and the anonymous wizard's "Menü" with an open visit
// ("Von vorne beginnen" moved out of the header into it). The dual-viewport
// config covers desktop and mobile.

import { test, expect, type Page } from "@playwright/test"
import { clearCollections, openGuestSection, waitForLoginCode } from "./helpers"
import { AUTH_USER_EMAIL } from "./global-setup"

async function signIn(page: Page) {
  await clearCollections("loginCodes")
  await page.goto("/login")
  await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
  await page.getByTestId("login-email-submit").click()
  await expect(page.getByTestId("login-code-stage")).toBeVisible({ timeout: 5000 })
  const entry = await waitForLoginCode(AUTH_USER_EMAIL)
  expect(entry).toBeTruthy()
  await page.getByTestId("login-code-input").fill(entry!.code)
  await page.getByTestId("login-code-submit").click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 10_000,
  })
}

function personField(page: Page, label: string) {
  return page
    .locator(`label:has-text("${label}")`)
    .first()
    .locator("..")
    .locator("input")
}

test.describe("Header menu screenshots", () => {
  test.beforeEach(async () => {
    await clearCollections("checkouts")
  })

  test("member area — menu open", async ({ page, isMobile }) => {
    await signIn(page)
    await page.goto("/account/profile")
    await expect(page.getByRole("heading", { name: "Profil" })).toBeVisible({
      timeout: 10_000,
    })

    await page.getByTestId("app-menu-trigger").click()
    if (isMobile) {
      const sheet = page.getByTestId("app-menu-sheet")
      await expect(sheet).toBeVisible()
      await expect(
        sheet.getByRole("link", { name: "Neuer Besuch starten" }),
      ).toBeVisible()
      await expect(sheet.getByRole("button", { name: "Abmelden" })).toBeVisible()
      await page.waitForTimeout(600)
    } else {
      await expect(page.getByRole("menu")).toContainText(AUTH_USER_EMAIL)
      await expect(page.getByRole("menuitem").first()).toHaveText("Profil")
    }

    await expect(page).toHaveScreenshot("header-menu-member.png")
  })

  test("anonymous wizard with an open visit — menu open", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/checkin")
    await openGuestSection(page)

    await personField(page, "Vorname").fill("Max")
    await personField(page, "Nachname").fill("Muster")
    await personField(page, "E-Mail").fill("max@test.com")
    await page.locator("#terms-accept").click()
    await page.getByRole("button", { name: "Weiter" }).click()
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()

    const trigger = page.getByRole("button", { name: "Menü" })
    await expect(trigger).toBeVisible()
    await trigger.click()
    const entry = isMobile
      ? page.getByTestId("app-menu-sheet").getByRole("button", {
          name: "Von vorne beginnen",
        })
      : page.getByRole("menuitem", { name: "Von vorne beginnen" })
    await expect(entry).toBeVisible()
    if (isMobile) await page.waitForTimeout(600)

    await expect(page).toHaveScreenshot("header-menu-anon-visit.png")

    // The confirm dialog outlives the menu; cancelling keeps the visit.
    await entry.click()
    await expect(page.getByText("Besuch verwerfen?")).toBeVisible()
    await page.getByRole("button", { name: "Abbrechen" }).click()
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()
  })
})
