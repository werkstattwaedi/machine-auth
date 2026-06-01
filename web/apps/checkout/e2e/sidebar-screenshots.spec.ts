// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Regression net for issue #212: the desktop sidebar must stay
// viewport-bound (sticky) so the footer (avatar + sign-out) is visible
// even when main content scrolls. The dual-viewport playwright config
// (`chromium` + `mobile-chrome`) covers both desktop and mobile in one
// test file.
//
// Also the regression net for issue #363: the active nav item and the
// primary "Neuer Besuch starten" CTA must NOT look the same. The active
// item gets a subtle pale tint (`bg-cog-teal-light` + dark-teal text),
// while the solid teal fill (`bg-cog-teal` + white text) is reserved for
// the primary visit CTA. The screenshots lock the visual distinction; the
// explicit class assertions below fail loudly if anyone reverts the active
// style to a solid fill, independent of snapshot regeneration.

import { test, expect, type Page } from "@playwright/test"
import { clearCollections, waitForLoginCode } from "./helpers"
import { AUTH_USER_EMAIL } from "./global-setup"

/** Sign in as the seeded auth user via the 6-digit code flow. */
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

test.describe("Sidebar screenshots", () => {
  test("profile page — sidebar with avatar footer", async ({ page }) => {
    await signIn(page)
    await page.goto("/account/profile")
    await expect(
      page.getByRole("heading", { name: "Profil" }),
    ).toBeVisible({ timeout: 10_000 })
    // Sanity: the seeded display name should be rendered in the sidebar
    // footer (desktop only — mobile sheet is closed).
    await expect(page).toHaveScreenshot("sidebar-profile.png")
  })

  test("membership page — sidebar with avatar footer", async ({ page }) => {
    await signIn(page)
    await page.goto("/account/membership")
    await expect(
      page.getByRole("heading", { name: "Mitgliedschaft" }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveScreenshot("sidebar-membership.png")
  })

  // Issue #363: the active nav item must read as a subtle "current page"
  // marker, NOT the solid-teal CTA fill. We assert it on the computed
  // background color so the guard survives Tailwind class renames and fails
  // even if someone forgets to regenerate the screenshot baselines.
  //
  // Desktop only — the desktop sidebar mounts the nav links directly, so the
  // class check is deterministic. The mobile layout hides the same nav
  // behind a sheet; its visual distinction is already covered by the
  // mobile-chrome screenshot baselines above.
  test("active nav item is subtle, distinct from the solid visit CTA", async ({
    page,
    isMobile,
  }) => {
    test.skip(
      isMobile,
      "nav links live in a sheet on mobile; covered by screenshots",
    )
    await signIn(page)
    await page.goto("/account/profile")
    await expect(
      page.getByRole("heading", { name: "Profil" }),
    ).toBeVisible({ timeout: 10_000 })

    const solidTeal = "rgb(77, 189, 198)" // --color-cog-teal #4dbdc6
    const subtleTint = "rgb(232, 247, 248)" // --color-cog-teal-light #e8f7f8

    // The primary "Neuer Besuch starten" CTA keeps the solid teal fill.
    const cta = page.getByRole("link", { name: "Neuer Besuch starten" }).first()
    await expect(cta).toBeVisible({ timeout: 10_000 })
    const ctaBg = await cta.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    )
    expect(ctaBg).toBe(solidTeal)

    // The active nav item ("Profil") uses the SUBTLE tint, never the solid
    // CTA fill — that look-alike was the whole bug.
    const active = page.getByRole("link", { name: "Profil" }).first()
    await expect(active).toBeVisible({ timeout: 10_000 })
    const activeBg = await active.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    )
    expect(activeBg).toBe(subtleTint)
    expect(activeBg).not.toBe(solidTeal)
  })
})
