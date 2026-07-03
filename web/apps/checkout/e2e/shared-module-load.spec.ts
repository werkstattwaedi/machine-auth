// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Regression for issue #326: the `@oww/shared` CJS workspace package
// must load cleanly in Vite's dev server. Before the fix, Vite couldn't
// statically extract named exports from `shared/dist/index.js` (which
// uses TypeScript's `__exportStar` form for `export *`), producing a
// browser-side `SyntaxError: The requested module … does not provide
// an export named 'priceForTier'` on every page load. The wizard then
// never rendered and the entire e2e suite went red on the first
// `expect(getByText('Deine Angaben')).toBeVisible()` assertion.
//
// This test catches that regression directly by collecting every page
// console message and pageerror event during a vanilla `page.goto('/')`
// and asserting that the shared module loaded without a SyntaxError.
// It runs before the full e2e suite would fail, so a future packaging
// regression is diagnosed clearly at the source instead of bubbling up
// as ~120 mysterious "step 0 missing" failures.

import { test, expect } from "@playwright/test"

test.describe("shared package loads in Vite dev server (#326)", () => {
  test("page load does not emit a SyntaxError from @oww/shared", async ({
    page,
  }) => {
    const errors: string[] = []

    // Browser-side uncaught exceptions surface here.
    page.on("pageerror", (err) => {
      errors.push(`${err.name}: ${err.message}`)
    })

    // Vite's HMR client logs `[vite] (client) [Unhandled error] …` via
    // console.error for module resolution failures — capture those too.
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text())
      }
    })

    await page.goto("/")

    // Give the wizard a moment to render so any deferred module-load
    // errors have a chance to surface. (Anonymous /checkin shows the
    // account/guest switcher since the sign-in redesign.)
    await expect(page.getByTestId("checkin-seg-account")).toBeVisible({
      timeout: 10_000,
    })

    const sharedModuleErrors = errors.filter(
      (e) =>
        e.includes("@oww/shared") ||
        e.includes("shared/dist/") ||
        /does not provide an export named/.test(e),
    )

    expect(
      sharedModuleErrors,
      `Unexpected module-load errors mentioning @oww/shared:\n${sharedModuleErrors.join("\n")}`,
    ).toEqual([])
  })
})
