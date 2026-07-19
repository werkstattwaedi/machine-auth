// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for issue #568 — a desktop-only symmetric scrollbar
 * gutter (`scrollbar-gutter: stable both-edges` on `html`, scoped to the `md`
 * breakpoint) must keep centered checkout content from shifting horizontally
 * when the document scrollbar toggles, while leaving mobile untouched.
 *
 * The checkout wizard scrolls at the document level. On a desktop platform
 * with *classic* (space-taking) scrollbars — the Windows/Linux default — a
 * vertical scrollbar appears once content overflows, narrowing the `<body>`
 * content box; the centered `max-w` column then recenters and the whole page
 * reflows ~half a scrollbar width to the left. Reserving the gutter up front
 * (symmetrically, so centered content stays put) eliminates that shift.
 *
 * Test-environment caveat: headless chromium renders *overlay* scrollbars,
 * which take zero layout width. The reserved gutter still insets desktop
 * content (that is why the desktop screenshot baselines were regenerated for
 * this change), but a *short-vs-tall delta* assertion cannot catch a
 * regression: with the fix the gutter is reserved in both states (no delta),
 * and without the fix the overlay scrollbar in the tall state takes no space
 * either (still no delta) — so the toggle-shift the bug describes never
 * reproduces here. The load-bearing, fail-without-fix guard is therefore the
 * resolved `scrollbar-gutter` value on `html`, checked at both viewports: it
 * must be `stable both-edges` on desktop (regresses to `auto` if the rule is
 * removed, revalued, or mis-scoped) and `auto` on mobile (proves the fix
 * leaves phones' full-bleed dividers alone). The behavioral no-shift assertion
 * is kept alongside it to encode the user-facing invariant and to catch a real
 * toggle shift on any classic-scrollbar runner.
 */

import { test, expect, type Page } from "@playwright/test"
import { openGuestSection } from "./helpers"

/** Navigate to checkout — the check-in step is shown directly, with the
 *  account section of the switcher as the anonymous default. */
async function goToCheckin(page: Page) {
  await page.goto("/")
  await expect(page.getByTestId("checkin-seg-account")).toBeVisible({
    timeout: 10_000,
  })
}

async function hasDocumentScrollbar(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight,
  )
}

test.describe("Scrollbar gutter — no content shift on toggle (issue #568)", () => {
  test("reserves a symmetric gutter on desktop only, keeping content from shifting", async ({
    page,
  }, testInfo) => {
    const isDesktop = testInfo.project.name === "chromium"

    await goToCheckin(page)

    // Load-bearing guard: the desktop-only rule is applied at md+ and not
    // below it. Fails without the fix (resolves to "auto" on desktop) and
    // proves mobile is left untouched.
    const gutter = await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollbarGutter,
    )
    expect(gutter).toBe(isDesktop ? "stable both-edges" : "auto")

    // The behavioral no-shift assertion only applies where the gutter is
    // reserved (desktop). On mobile there is nothing to check.
    if (!isDesktop) return

    // Short state: the account idle view fits the viewport, so there is no
    // document scrollbar yet — otherwise there would be no toggle to exercise.
    expect(
      await hasDocumentScrollbar(page),
      "short state must not scroll — otherwise the scrollbar never toggles",
    ).toBe(false)

    // A centered reference inside the wizard's max-w column. When the body
    // narrows by a classic scrollbar's width, this recenters and its left
    // edge moves; with the reserved gutter it stays put.
    const reference = page.getByTestId("checkin-seg-guest")
    await expect(reference).toBeVisible()
    const leftShort = (await reference.boundingBox())!.x

    // Grow the page tall enough to force a document scrollbar: open the guest
    // section and add extra person cards.
    await openGuestSection(page)
    await page.getByRole("button", { name: "Person hinzufügen" }).click()
    await expect(page.getByText("Person 2")).toBeVisible()
    await page.getByRole("button", { name: "Person hinzufügen" }).click()
    await expect(page.getByText("Person 3")).toBeVisible()

    // Tall state now overflows the viewport → the scrollbar toggles on.
    expect(
      await hasDocumentScrollbar(page),
      "tall state must scroll so the scrollbar toggles on",
    ).toBe(true)

    const leftTall = (await reference.boundingBox())!.x

    // Centered content must not shift when the scrollbar appears. (Under the
    // test env's overlay scrollbars this holds regardless; on a classic
    // scrollbar it fails without the reserved gutter.)
    expect(
      Math.abs(leftTall - leftShort),
      `centered content must not shift horizontally when the scrollbar appears (short ${leftShort}, tall ${leftTall})`,
    ).toBeLessThanOrEqual(1)
  })
})
