// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect, type Locator, type Page } from "@playwright/test"
import {
  clearCheckoutsDeep,
  clearCollections,
  seedMembershipState,
  seedOpenCheckoutWithMembership,
  waitForLoginCode,
  openGuestSection,
} from "./helpers"

const AUTH_USER_EMAIL = "e2e-test@werkstattwaedi.ch"

/** Navigate to checkout → fill check-in → advance to workshops */
async function goToWorkshops(page: Page) {
  await page.goto("/")
  await openGuestSection(page)

  // Fill required person fields
  await page.locator('label:has-text("Vorname")').first().locator("..").locator("input").fill("Max")
  await page.locator('label:has-text("Nachname")').first().locator("..").locator("input").fill("Muster")
  await page.locator('label:has-text("E-Mail")').first().locator("..").locator("input").fill("max@test.com")
  await page.locator("#terms-accept").click()

  await page.getByRole("button", { name: "Weiter" }).click()
  await expect(page.getByText("Werkstätten wählen")).toBeVisible()
}

/** Navigate to checkout summary (step 3) with no items */
async function goToSummary(page: Page) {
  await goToWorkshops(page)
  const checkoutBtn = page.getByRole("button", { name: "Zum Checkout" })
  await checkoutBtn.scrollIntoViewIfNeeded()
  await checkoutBtn.click()
  await expect(page.getByText("Dein Besuch")).toBeVisible()
}

/**
 * Pick a Nutzungsart on the check-in (issue #605: chosen per person there,
 * read-only on Check Out). `scope` is the person's strip or card.
 */
async function chooseUsageType(page: Page, scope: Locator, label: string) {
  await scope.getByTestId("usage-type-trigger").click()
  await page.getByRole("option", { name: label, exact: true }).click()
  await expect(scope.getByTestId("usage-type-trigger")).toContainText(label)
}

/**
 * Navigate to checkout summary with a holz item added. `signedIn` runs the
 * flow as the E2E auth user instead of an anonymous guest — needed for the
 * owner-only usage types (Freiwilligengruppe, Interne Nutzung), which a
 * guest check-in never offers (#570, #605); `usageType` is then picked on
 * the owner's line before advancing.
 */
async function goToSummaryWithItems(
  page: Page,
  { signedIn = false, usageType }: { signedIn?: boolean; usageType?: string } = {},
) {
  if (signedIn) {
    await signIn(page)
    // Logged-in user sees the pre-filled form; advance to workshops.
    await page.goto("/")
    await expect(page.getByTestId("identity-strip").first()).toBeVisible({ timeout: 10_000 })
    if (usageType) {
      await chooseUsageType(page, page.getByTestId("identity-strip").first(), usageType)
    }
    await page.getByRole("button", { name: "Weiter" }).click()
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()
  } else {
    await goToWorkshops(page)
  }

  await page.getByRole("button", { name: "Holz", exact: true }).click()
  const holzSection = page.getByTestId("workshop-block-holz")

  // Open the MaterialPicker sheet for Holz
  await holzSection.getByRole("button", { name: "Material hinzufügen" }).click()
  await expect(page.getByText("Schleifpapier")).toBeVisible()
  await page.getByText("Schleifpapier").click()

  // Set quantity to 3 (CHF 2 × 3 = CHF 6)
  const qtyInput = page.locator('label:has-text("Anzahl")').locator("..").locator("input")
  await qtyInput.fill("3")

  // Commit the row, then close the picker so the rest of the page is clickable
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click()
  await page.getByRole("button", { name: "Schliessen" }).click()
  await expect(page.locator(`[data-slot="sheet-overlay"]`)).toBeHidden()

  const checkoutBtn = page.getByRole("button", { name: "Zum Checkout" })
  await checkoutBtn.scrollIntoViewIfNeeded()
  await checkoutBtn.click()
  await expect(page.getByText("Dein Besuch")).toBeVisible()
}

/** Sign in as the seeded test user via the 6-digit code flow. */
async function signIn(page: Page) {
  // Drop any prior loginCodes so the per-email 60 s rate limit doesn't
  // reject back-to-back tests sharing this helper.
  await clearCollections("loginCodes")

  await page.goto("/login")
  await page.getByTestId("login-email-input").fill(AUTH_USER_EMAIL)
  await page.getByTestId("login-email-submit").click()
  await expect(page.getByTestId("login-code-stage")).toBeVisible({ timeout: 5000 })

  const entry = await waitForLoginCode(AUTH_USER_EMAIL)
  expect(entry).toBeTruthy()
  await page.getByTestId("login-code-input").fill(entry!.code)
  await page.getByTestId("login-code-submit").click()

  // Post-login: wait for any non-login URL.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 })
}

/**
 * Sign in and go to the Check Out page (step 3) with an empty cart.
 *
 * Uses a logged-in user so the commit closes an existing open doc
 * (open → closed). Logged-in users also have no auto-reset timer.
 */
async function goToSignedInSummary(page: Page, usageType?: string) {
  await signIn(page)

  // Navigate to checkout — logged-in user sees pre-filled form
  await page.goto("/")
  const strip = page.getByTestId("identity-strip").first()
  await expect(strip).toBeVisible({ timeout: 10_000 })
  if (usageType) await chooseUsageType(page, strip, usageType)

  // Advance to workshops
  await page.getByRole("button", { name: "Weiter" }).click()
  await expect(page.getByText("Werkstätten wählen")).toBeVisible()

  // Go to summary
  const checkoutBtn = page.getByRole("button", { name: "Zum Checkout" })
  await checkoutBtn.scrollIntoViewIfNeeded()
  await checkoutBtn.click()
  await expect(page.getByText("Dein Besuch")).toBeVisible()
}

/**
 * Choose a payment card on step 3 and wait for step 4 in place (issue
 * #750). The fold animates for ~420 ms; wait for the frame and then for the
 * folded summary to be gone so the shot is stable.
 */
async function choosePayment(page: Page, testId: string) {
  const card = page.getByTestId(testId)
  await card.scrollIntoViewIfNeeded()
  await card.click()
  await expect(page.getByTestId("payment-frame")).toBeVisible()
  // The folded block stays in the DOM (height 0, faded), so wait for the
  // fold to finish rather than for it to vanish.
  await expect(
    page.locator("[aria-hidden='true']").filter({ hasText: "Dein Besuch" }),
  ).toHaveCSS("opacity", "0")
  await page.evaluate(() => window.scrollTo(0, 0))
}

test.describe("Checkout step screenshots", () => {
  // Start every test from a clean cart. The other checkout specs all clear
  // checkouts in a beforeEach; this one didn't. Without it, a membership
  // test that fails before its trailing clearCheckoutsDeep() leaks an open
  // membership-only checkout for the shared auth user, which the next
  // signed-in test (notably the Step 4 payment shots on the *second* browser
  // project) then rehydrates — hiding "Werkstätten wählen" and cascading
  // failures across viewports.
  test.beforeEach(async () => {
    await clearCheckoutsDeep()
  })

  // The Sammelrechnung-member test below stamps an active-single
  // membership on the shared auth user doc. Reset after *every* test so
  // the stamp can't leak forward into a later test that expects a
  // non-member view (e.g. the TWINT tab test). afterAll is insufficient:
  // it runs only after the whole describe, leaving the leaked membership
  // visible to tests that run between the seeding test and the end.
  test.afterEach(async () => {
    const uid = process.env.E2E_AUTH_USER_UID
    if (uid) await seedMembershipState(uid, { kind: "none" })
  })

  test("empty workshop form", async ({ page }) => {
    await goToWorkshops(page)

    await expect(page).toHaveScreenshot("checkout-workshops-empty.png")
  })

  test("holz and makerspace selected", async ({ page }) => {
    await goToWorkshops(page)

    await page.getByRole("button", { name: "Holz", exact: true }).click()
    await page.getByRole("button", { name: "Maker Space", exact: true }).click()

    // Wait for both workshop sections to appear
    await expect(page.getByText("Holz").first()).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Material hinzufügen" }).first(),
    ).toBeVisible()

    await expect(page).toHaveScreenshot("checkout-workshops-selected.png")
  })

  test("add article dropdown open", async ({ page }) => {
    await goToWorkshops(page)

    await page.getByRole("button", { name: "Holz", exact: true }).click()
    await expect(
      page.getByRole("button", { name: "Material hinzufügen" }),
    ).toBeVisible()

    // Pin the background scroll to the top before opening the picker. The
    // material Sheet preserves the page scroll position when it opens
    // (issue #401) via a short rAF loop seeded from the scroll offset at
    // click time. Opening from a non-zero offset left the background wizard
    // at an environment-dependent scroll in this screenshot (CI rendered at
    // the top, local ~90px down), so the baseline was unstable. Opening from
    // the top keeps it deterministic.
    await page.evaluate(() => window.scrollTo(0, 0))

    // Open the add article search
    await page.getByRole("button", { name: "Material hinzufügen" }).click()

    // Wait for dropdown to be visible
    await expect(page.getByText("E2E Testmaterial")).toBeVisible()

    // Press Tab to highlight the first item instead of blinking cursor
    await page.keyboard.press("Tab")

    // Let issue #401's post-open scroll-restore rAF window (~600ms) settle,
    // then re-pin to the top so the background is stable before the snapshot.
    await page.waitForTimeout(700)
    await page.evaluate(() => window.scrollTo(0, 0))

    await expect(page).toHaveScreenshot("checkout-add-article-dropdown.png")
  })

  test("materials added with ad-hoc item", async ({ page }) => {
    await goToWorkshops(page)

    // Select holz + makerspace
    await page.getByRole("button", { name: "Holz", exact: true }).click()
    await page.getByRole("button", { name: "Maker Space", exact: true }).click()

    // Locate workshop sections by their heading
    const holzSection = page.getByTestId("workshop-block-holz")
    const makerSection = page.getByTestId("workshop-block-makerspace")

    // --- Add E2E Testmaterial (area pricing) in holz ---
    await holzSection
      .getByRole("button", { name: "Material hinzufügen" })
      .click()
    await expect(page.getByText("E2E Testmaterial")).toBeVisible()
    await page.getByText("E2E Testmaterial").click()
    await page.locator('label:has-text("Länge")').locator("..").locator("input").fill("60")
    await page.locator('label:has-text("Breite")').locator("..").locator("input").fill("40")
    await page.getByRole("button", { name: "Hinzufügen", exact: true }).click()
    await page.getByRole("button", { name: "Schliessen" }).click()
    await expect(page.locator(`[data-slot="sheet-overlay"]`)).toBeHidden()

    // --- Add Filament (weight pricing) in makerspace ---
    // On mobile the sticky bottom-nav can cover the add button; force: true
    // bypasses the actionability/overlap check (the button is keyboard-
    // reachable and we just want to open the picker).
    const makerAddBtn = makerSection.getByRole("button", { name: "Material hinzufügen" })
    await makerAddBtn.scrollIntoViewIfNeeded()
    await makerAddBtn.click({ force: true })
    await expect(page.getByText("Filament").first()).toBeVisible()
    // Click the first catalog button matching "Filament" (not "Filament (Spezial)")
    await page.locator("button").filter({ hasText: /^Filament/ }).first().click()
    await page.locator('label:has-text("Gewicht")').locator("..").locator("input").fill("100")
    await page.getByRole("button", { name: "Hinzufügen", exact: true }).click()
    await page.getByRole("button", { name: "Schliessen" }).click()
    await expect(page.locator(`[data-slot="sheet-overlay"]`)).toBeHidden()

    // --- Add ad-hoc Maschinenzeit (time pricing) in holz ---
    const holzAddBtn2 = holzSection.getByRole("button", { name: "Material hinzufügen" })
    await holzAddBtn2.scrollIntoViewIfNeeded()
    await holzAddBtn2.click({ force: true })
    await page.getByPlaceholder("Material suchen…").fill("Maschinennutzung")
    await page.getByText("Maschinenzeit").click()
    // Fill description, time and rate so the row commits
    await page.locator('label:has-text("Beschreibung")').locator("..").locator("input").fill("Maschinennutzung")
    await page.locator('label:has-text("Zeit")').locator("..").locator("input").fill("60")
    await page.locator('label:has-text("Preis")').locator("..").locator("input").first().fill("20")
    await page.getByRole("button", { name: "Hinzufügen", exact: true }).click()
    await page.getByRole("button", { name: "Schliessen" }).click()
    await expect(page.locator(`[data-slot="sheet-overlay"]`)).toBeHidden()

    // Pin the page to the top and keep re-pinning until it sticks. The
    // close-path scroll restore (#451) re-applies the pre-open offset (here:
    // scrolled down to the holz add button) on an rAF schedule whose end we
    // can't observe — a single pin after a fixed settle loses that race on
    // slow runners, which left this baseline permanently red on CI. Each
    // poll iteration pins, out-waits the ~600ms restore window, and only
    // passes once the pin survived it.
    await expect
      .poll(
        async () => {
          await page.evaluate(() => window.scrollTo(0, 0))
          await page.waitForTimeout(700)
          return page.evaluate(() => window.scrollY)
        },
        { timeout: 10_000 },
      )
      .toBe(0)

    await expect(page).toHaveScreenshot("checkout-materials-added.png")
  })

  // Issue #656: a zero / empty quantity used to leave Hinzufügen silently
  // disabled. The field now says why on blur, and the entry unit stays
  // visible as an in-field suffix while typing.
  test("material picker — zero quantity shows inline error", async ({ page }) => {
    await goToWorkshops(page)
    await page.getByRole("button", { name: "Holz", exact: true }).click()
    const holzSection = page.getByTestId("workshop-block-holz")

    // Pin the background scroll before opening the picker (see "SLA row").
    await page.evaluate(() => window.scrollTo(0, 0))
    await holzSection
      .getByRole("button", { name: "Material hinzufügen" })
      .click()
    await expect(page.getByText("E2E Testmaterial")).toBeVisible()
    await page.getByText("E2E Testmaterial").click()

    const lengthInput = page
      .locator('label:has-text("Länge")')
      .locator("..")
      .locator("input")
    await lengthInput.fill("0")
    // Blur by Tabbing to Breite — clicking outside hits the picker overlay.
    await page.keyboard.press("Tab")
    await expect(page.getByRole("alert")).toHaveText(
      "Bitte eine Zahl grösser als 0 eingeben",
    )
    await expect(
      page.getByRole("button", { name: "Hinzufügen", exact: true }),
    ).toBeDisabled()

    // Let issue #401's scroll-restore rAF window settle, then re-pin.
    await page.waitForTimeout(700)
    await page.evaluate(() => window.scrollTo(0, 0))

    await expect(page).toHaveScreenshot("checkout-picker-quantity-error.png")
  })

  test("summary — entry fees only", async ({ page }) => {
    await goToSummary(page)

    await expect(page).toHaveScreenshot("checkout-summary-empty.png")
  })

  test("summary — with workshop items", async ({ page }) => {
    await goToSummaryWithItems(page)

    await expect(page).toHaveScreenshot("checkout-summary-items.png")
  })

  test("summary — with workshop items scrolled — sticky nav bar at bottom", async ({ page }) => {
    await goToSummaryWithItems(page)

    // Scroll down so the item list is visible above the fold and the sticky
    // payment bar is anchored to the viewport bottom (as users see it)
    await page.evaluate(() => window.scrollBy(0, 200))

    // Capture viewport only — sticky bar should appear at viewport bottom
    await expect(page).toHaveScreenshot("checkout-summary-scrolled-sticky-nav.png")
  })

  test("summary — tip with round-up", async ({ page }) => {
    await goToSummaryWithItems(page)

    // Enter a fractional manual tip so the round-up row is still
    // exercised even when the seeded subtotal lands on a whole franc
    // (#204: whole-franc bases now hide round-up suggestions).
    // On a phone the Spende box starts folded to one line (#750).
    const collapsedSpende = page.getByRole("button", { name: /Trinkgeld\/Spende/ })
    if (await collapsedSpende.count()) await collapsedSpende.click()
    const tipInput = page.getByRole("textbox", { name: "Trinkgeld/Spende" })
    await tipInput.fill("0.50")

    // The round-up row appears once there's a positive base. The dropdown
    // owns the friendly target labels ("nächsten Franken" / "X Franken").
    const targetSelect = page.getByLabel("Aufrunden-Ziel")
    await expect(targetSelect).toBeVisible()

    // Picking a target also auto-checks the "Aufrunden" checkbox.
    await targetSelect.selectOption({ index: 0 })

    // Blur the tip input to avoid cursor blink
    await page.locator("h1, h2").first().click()

    await expect(page).toHaveScreenshot("checkout-summary-tip.png")
  })

  test("summary — Nutzungsgebühren expanded (per-person lines)", async ({ page }) => {
    await goToSummary(page)

    // Everyone on Reguläre Nutzung: the section starts collapsed (CHK-31)
    // and opens to read-only per-person lines (#605).
    const section = page.getByRole("button", { name: /Nutzungsgebühren/ })
    await expect(section).toHaveAttribute("aria-expanded", "false")
    await section.click()
    await expect(page.getByTestId("usage-fee-person")).toHaveCount(1)
    await expect(page.getByTestId("usage-type-trigger")).toHaveCount(0)

    // Click a neutral spot so the screenshot is stable
    await page.locator("h1").first().click()

    await expect(page).toHaveScreenshot("checkout-summary-nutzung-expanded.png")
  })

  // Issues #570, #605: the Nutzungsart dropdown on the check-in explains
  // every usage type (price effect + who it applies to). A guest never sees
  // the two owner-only types; the open list is worth pixel-guarding.
  test("check-in — Nutzungsart dropdown open (guest: owner-only types hidden)", async ({ page }) => {
    await page.goto("/")
    await openGuestSection(page)

    const card = page.getByTestId("person-card").first()
    await card.getByTestId("usage-type-trigger").click()
    await expect(
      page.getByRole("option", { name: "Hangenmoos AG", exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole("option", { name: "Freiwilligengruppe", exact: true }),
    ).toBeHidden()
    await expect(
      page.getByRole("option", { name: "Interne Nutzung", exact: true }),
    ).toBeHidden()

    await expect(page).toHaveScreenshot("checkin-nutzungsart-open.png")

    // Escape closes without changing the selection.
    await page.keyboard.press("Escape")
    await expect(page.getByRole("option", { name: "Hangenmoos AG", exact: true })).toBeHidden()
    await expect(card.getByTestId("usage-type-trigger")).toContainText("Reguläre Nutzung")
  })

  // CHK-32 (#779): an owner-only Nutzungsart disables "Person hinzufügen";
  // the reason is a tooltip, opened by a tap (mobile-chrome is touch, so
  // this covers the kiosk), not a line under the button.
  test("check-in — Freiwilligengruppe: add-person reason as tooltip", async ({ page }) => {
    await signIn(page)
    await page.goto("/")
    const strip = page.getByTestId("identity-strip").first()
    await expect(strip).toBeVisible({ timeout: 10_000 })
    await chooseUsageType(page, strip, "Freiwilligengruppe")

    await expect(page.getByTestId("add-person")).toBeDisabled()
    const tooltip = page.locator('[data-slot="tooltip-content"]')
    await expect(tooltip).toHaveCount(0)

    // tap() and click() wait until the wrapper receives events (the closing
    // Select briefly keeps pointer-events off the body).
    const trigger = page.getByTestId("add-person-disabled")
    if (test.info().project.name === "mobile-chrome") await trigger.tap()
    else await trigger.click()
    await expect(tooltip).toBeVisible()

    await expect(page).toHaveScreenshot("checkin-add-person-reason-tooltip.png")
  })

  // CHK-8 (#605): machine time with every person on „Begleitung / nur
  // Materialbezug" can't be billed — Check Out says so in Maschinen and
  // disables the payment cards, instead of a server refusal on submit.
  test("summary — machine usage with everyone on Begleitung is blocked", async ({ page }) => {
    await signIn(page)
    await page.goto("/")
    const strip = page.getByTestId("identity-strip").first()
    await expect(strip).toBeVisible({ timeout: 10_000 })
    await chooseUsageType(page, strip, "Begleitung / nur Materialbezug")
    await page.getByRole("button", { name: "Weiter" }).click()
    await expect(page.getByText("Werkstätten wählen")).toBeVisible()

    // Metall carries the pinned "Standbohrmaschine" (CHF 30/h) — an
    // always-visible manual hours input (#105). 2 h → CHF 60.00.
    await page.getByRole("button", { name: "Metall", exact: true }).click()
    const block = page.getByTestId("workshop-block-metall")
    await block.getByLabel("Stunden Standbohrmaschine").fill("2")
    // Blur commits the line; wait for the subtotal so the item doc exists
    // before we move on to the summary.
    await page.locator("h1").first().click()
    await expect(block.getByText("CHF 60.00")).toBeVisible({ timeout: 10_000 })

    const checkoutBtn = page.getByRole("button", { name: "Zum Checkout" })
    await checkoutBtn.scrollIntoViewIfNeeded()
    await checkoutBtn.click()
    await expect(page.getByText("Dein Besuch")).toBeVisible()

    await expect(page.getByTestId("machine-usage-blocked")).toBeVisible()
    // Begleitung prices the machine time at CHF 0, so the one card offered
    // may be "Kostenlos" (#750) — whichever it is, it is disabled.
    const cards = page.locator('[data-testid^="payment-option-"]')
    await expect(cards.first()).toBeVisible()
    for (const card of await cards.all()) await expect(card).toBeDisabled()

    await page.locator("h1").first().click()
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(page).toHaveScreenshot("checkout-summary-machine-blocked.png")
  })

  test("summary — Materialbezug expanded with workshop items", async ({ page }) => {
    await goToSummaryWithItems(page)

    await page.getByRole("button", { name: /Materialbezug/ }).click()
    await expect(page.getByText("Bezogenes Material")).toBeVisible()

    await page.locator("h1").first().click()

    await expect(page).toHaveScreenshot("checkout-summary-material-expanded.png")
  })

  // Issue #284: a discounted usage type changes the summary — entry/machine
  // fees are waived (net 0) and an inline SectionDiscountNote explains why,
  // while non-waived sections (material for volunteering) still bill in full.
  // No existing fixture used a discounted usage type, so the new rendering
  // had no visual-regression coverage (PR #346 review feedback).
  test("summary — Freiwilligengruppe waives entry, bills material (discount note)", async ({ page }) => {
    // Owner-only usage type → identified visitor, picked on the check-in
    // (#570, #605).
    await goToSummaryWithItems(page, {
      signedIn: true,
      usageType: "Freiwilligengruppe",
    })

    // A discounted type opens Nutzungsgebühren on arrival (CHK-31) with the
    // confirmation box (CHK-30).
    await expect(
      page.getByRole("button", { name: /Nutzungsgebühren/ }),
    ).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByTestId("usage-type-declaration")).toBeVisible()

    // Click a neutral spot so the screenshot is stable.
    await page.locator("h1").first().click()
    await page.evaluate(() => window.scrollTo(0, 0))

    await expect(page).toHaveScreenshot("checkout-summary-volunteering-discount.png")
  })

  // Issue #284 / Marco's original complaint: an "Interne Nutzung" checkout
  // showed full line items but a CHF 0.00 total with no explanation. The
  // discount notes now spell out every waived section. Expand both
  // Nutzungsgebühren and Materialbezug so all notes are captured.
  test("summary — Interne Nutzung waives all sections (discount notes, CHF 0)", async ({ page }) => {
    // Owner-only usage type → identified visitor, picked on the check-in
    // (#570, #605).
    await goToSummaryWithItems(page, {
      signedIn: true,
      usageType: "Interne Nutzung",
    })

    // Expand Materialbezug too so its waived note is visible.
    await page.getByRole("button", { name: /Materialbezug/ }).click()
    await expect(page.getByText("Bezogenes Material")).toBeVisible()

    // Entry + material both waived → at least two discount notes present.
    await expect(page.getByTestId("section-discount-note").first()).toBeVisible()

    await page.locator("h1").first().click()

    await expect(page).toHaveScreenshot("checkout-summary-intern-discount.png")
  })

  test("Step 4 · QR-Rechnung chosen — the card opens under 'Zu bezahlen'", async ({ page }, testInfo) => {
    testInfo.setTimeout(60_000)
    await goToSignedInSummary(page)
    await choosePayment(page, "payment-option-rechnung")

    await expect(page.getByRole("button", { name: "Rechnung senden" })).toBeVisible()
    await expect(page).toHaveScreenshot("checkout-payment-rechnung.png")
  })

  test("Confirmation · QR-Rechnung sent — QR slip behind the disclosure", async ({ page }, testInfo) => {
    testInfo.setTimeout(60_000)
    await goToSignedInSummary(page)
    await choosePayment(page, "payment-option-rechnung")
    await page.getByRole("button", { name: "Rechnung senden" }).click()

    await expect(page.getByTestId("payment-confirmation")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("button", { name: /PDF herunterladen/ })).toBeVisible()
    // Desktop offers the QR slip; a phone never does.
    const disclosure = page.getByRole("button", { name: /QR-Code anzeigen/ })
    if (testInfo.project.name === "mobile-chrome") {
      await expect(disclosure).toHaveCount(0)
    } else {
      await disclosure.click()
      await expect(page.getByTestId("payment-qr")).toBeVisible()
    }

    // Mask the QR — its pixels encode the per-run bill reference.
    await expect(page).toHaveScreenshot("checkout-confirmation-rechnung.png", {
      mask: [page.getByTestId("payment-qr")],
    })
  })

  // Issue #237 / #750: a CHF 0 visit ("Interne Nutzung", chosen on the
  // check-in, #605) offers the single "Kostenlos" card instead of the
  // payment methods; it closes at once.
  test("Step 3 · zero amount (Interne Nutzung) — single 'Kostenlos' card, then done", async ({ page }, testInfo) => {
    testInfo.setTimeout(60_000)
    // "Interne Nutzung" zeros entry + machine + material costs both client-
    // and server-side (issue #199), giving a CHF 0.00 bill.
    await goToSignedInSummary(page, "Interne Nutzung")

    const free = page.getByTestId("payment-option-free")
    await expect(free).toBeVisible()
    await expect(page.getByTestId("payment-option-rechnung")).toHaveCount(0)
    // Scroll to the bottom: the shot is of the card.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page).toHaveScreenshot("checkout-payment-zero.png")

    await free.click()
    await expect(page.getByTestId("payment-confirmation")).toBeVisible({ timeout: 30_000 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(page).toHaveScreenshot("checkout-confirmation-zero.png")
  })

  // Issue #245: the Sammelrechnung is offered to members only.
  test("Step 4 · Sammelrechnung (member) — chosen, then confirmed", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(60_000)

    // Stamp an active-single membership on the seeded auth user so the
    // Sammelrechnung card renders. Reset is handled by the describe-level
    // afterEach.
    const uid = process.env.E2E_AUTH_USER_UID
    test.skip(!uid, "E2E_AUTH_USER_UID not set (global-setup did not run)")
    await seedMembershipState(uid!, { kind: "active-single" })

    await goToSignedInSummary(page)
    await choosePayment(page, "payment-option-monthly")
    // Mask the date: it is the first of next month and moves with the clock.
    await expect(page).toHaveScreenshot("checkout-payment-monthly-member.png", {
      mask: [page.getByTestId("monthly-date")],
    })

    await page.getByRole("button", { name: "Auf Sammelrechnung setzen" }).click()
    await expect(page.getByTestId("payment-confirmation")).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveScreenshot("checkout-confirmation-monthly.png", {
      mask: [page.getByTestId("monthly-date")],
    })
  })

  test("Step 4 · TWINT chosen — its pay button, nothing committed yet", async ({ page }, testInfo) => {
    testInfo.setTimeout(60_000)
    await goToSignedInSummary(page)

    // The Sammelrechnung card is gated by `activeMembership`. The preceding
    // member test seeds it and the describe-level afterEach resets it server-
    // side, but the client reflects that reset through an async user-doc
    // listener. Wait for the non-member cards to settle before choosing (#448).
    await expect(page.getByTestId("payment-option-monthly")).toHaveCount(0)

    await choosePayment(page, "payment-option-raisenow")
    // Clicking the pay button would close the checkout and open a window;
    // the shot is of the step before.
    await expect(page.getByRole("button", { name: /Mit TWINT bezahlen/ })).toBeVisible()
    await expect(page).toHaveScreenshot("checkout-payment-twint.png")
  })

  test("SLA row — resin + layers filled", async ({ page }) => {
    await goToWorkshops(page)

    await page.getByRole("button", { name: "Maker Space", exact: true }).click()
    const makerSection = page.getByTestId("workshop-block-makerspace")

    // Pin the background scroll before opening the picker (same idiom as
    // "add article dropdown open"): the sheet preserves the page scroll via
    // a rAF window (issue #401), so opening from a non-zero offset leaves
    // the dimmed background at an environment-dependent scroll in the shot.
    // The chips row below the sections makes /visit tall enough to scroll,
    // which is what exposed this.
    await page.evaluate(() => window.scrollTo(0, 0))

    // Add the SLA catalog item from the makerspace section
    await makerSection
      .getByRole("button", { name: "Material hinzufügen" })
      .click()
    await expect(page.getByText("E2E SLA Resin")).toBeVisible()
    await page.getByText("E2E SLA Resin").click()

    // Fill Resin (ml) and Layer inputs. Labels aren't associated via htmlFor,
    // so walk from label → parent → input (same idiom as existing tests).
    const resinInput = page
      .locator('label:has-text("Resin")')
      .locator("..")
      .locator("input")
    await resinInput.fill("50")
    await resinInput.blur()

    const layerInput = page
      .locator('label:has-text("Layer")')
      .locator("..")
      .locator("input")
    await layerInput.fill("1000")
    // Blur by Tabbing out — clicking outside hits the picker overlay.
    await page.keyboard.press("Tab")

    // Let issue #401's scroll-restore rAF window settle, then re-pin the
    // background so the shot is deterministic (see comment above).
    await page.waitForTimeout(700)
    await page.evaluate(() => window.scrollTo(0, 0))

    await expect(page).toHaveScreenshot("checkout-sla-filled.png")
  })

  // The pre-v5 inline-rows let users add items with zero quantity then
  // surface errors at Check-Out. The v5 MaterialPicker enforces validation
  // at add-time (Hinzufügen button disabled until inputs are valid), so
  // this submit-time error state can no longer be reached from the UI.
  // Revisit if/when an item-edit affordance returns post-add.
  test.fixme("SLA row — validation errors (empty inputs)", async ({ page }) => {
    await goToWorkshops(page)
    await page.getByRole("button", { name: "Maker Space", exact: true }).click()
    await expect(page).toHaveScreenshot("checkout-sla-validation-errors.png")
  })

  test("summary — with SLA item", async ({ page }) => {
    await goToWorkshops(page)

    await page.getByRole("button", { name: "Maker Space", exact: true }).click()
    const makerSection = page.getByTestId("workshop-block-makerspace")

    // Add the SLA catalog item
    await makerSection
      .getByRole("button", { name: "Material hinzufügen" })
      .click()
    await expect(page.getByText("E2E SLA Resin")).toBeVisible()
    await page.getByText("E2E SLA Resin").click()

    // Fill Resin (ml) and Layer inputs
    const resinInput = page
      .locator('label:has-text("Resin")')
      .locator("..")
      .locator("input")
    await resinInput.fill("50")

    const layerInput = page
      .locator('label:has-text("Layer")')
      .locator("..")
      .locator("input")
    await layerInput.fill("1000")

    // Commit + close picker
    await page.getByRole("button", { name: "Hinzufügen", exact: true }).click()
    await page.getByRole("button", { name: "Schliessen" }).click()
    await expect(page.locator(`[data-slot="sheet-overlay"]`)).toBeHidden()

    // Go to summary
    const checkoutBtn = page.getByRole("button", { name: "Zum Checkout" })
    await checkoutBtn.scrollIntoViewIfNeeded()
    await checkoutBtn.click()
    await expect(page.getByText("Dein Besuch")).toBeVisible()

    await expect(page).toHaveScreenshot("checkout-summary-sla.png")
  })

  // Same reason as "SLA row — validation errors" above: with v5's
  // MaterialPicker, items can no longer be committed with zero values,
  // so this submit-time error state is unreachable from the UI.
  test.fixme("checkout validation errors", async ({ page }) => {
    await goToWorkshops(page)
    await page.getByRole("button", { name: "Holz", exact: true }).click()
    await expect(page).toHaveScreenshot("checkout-validation-errors.png")
  })

  // ── Vereinsmitgliedschaft as a dedicated section (issues #262 / #263) ──
  //
  // These seed an open checkout for the signed-in user carrying the
  // membership SKU (see seedOpenCheckoutWithMembership), so the wizard
  // rehydrates it and renders the new Vereinsmitgliedschaft bucket. The
  // seeded checkout is wiped at the end of each test so it can't leak into
  // later tests that expect a fresh cart (the describe-level afterEach only
  // resets membership state, not checkouts).

  test("summary — Vereinsmitgliedschaft membership-only cart", async ({
    page,
  }) => {
    const uid = process.env.E2E_AUTH_USER_UID
    test.skip(!uid, "E2E_AUTH_USER_UID not set (global-setup did not run)")
    await signIn(page)
    await seedOpenCheckoutWithMembership(uid!)

    // Post-refactor (#360), the seeded open-checkout-from-today is owned by
    // the signed-in user, so the wizard step lives at /visit. Navigate there
    // directly rather than bouncing through the `/` dispatcher — the
    // dispatcher's open-checkout subscription can momentarily read the
    // pre-seed empty state and route to /checkin, starting a fresh cart that
    // drops the seeded membership item (flaky). Gate on the membership block
    // to confirm the seeded checkout rehydrated before advancing.
    await page.goto("/visit")
    await expect(page.getByTestId("membership-block")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText("Werkstätten wählen")).toBeHidden()
    const checkoutBtn = page.getByRole("button", { name: "Zum Checkout" })
    await checkoutBtn.scrollIntoViewIfNeeded()
    await checkoutBtn.click()
    await expect(page.getByText("Dein Besuch")).toBeVisible()

    // The Vereinsmitgliedschaft section is present and the three regular
    // buckets are hidden (membership-only cart).
    await expect(
      page.getByRole("button", { name: /Vereinsmitgliedschaft/ }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: /Nutzungsgebühren/ }),
    ).toBeHidden()
    await expect(
      page.getByRole("button", { name: /Materialbezug/ }),
    ).toBeHidden()

    await expect(page).toHaveScreenshot("checkout-summary-membership-only.png")

    await clearCheckoutsDeep()
  })

  test("summary — Vereinsmitgliedschaft + workshop items", async ({ page }) => {
    const uid = process.env.E2E_AUTH_USER_UID
    test.skip(!uid, "E2E_AUTH_USER_UID not set (global-setup did not run)")
    await signIn(page)
    await seedOpenCheckoutWithMembership(uid!, { withWorkshopItem: true })

    // Go straight to the wizard step for the seeded open checkout (see the
    // membership-only test above for why `/` is avoided). Gate on the
    // membership block so the mixed cart is fully rehydrated before advancing.
    await page.goto("/visit")
    await expect(page.getByTestId("membership-block")).toBeVisible({
      timeout: 10_000,
    })
    // Mixed cart: the seeded workshop item keeps a section selected, so the
    // add-chips row titles "Weitere Werkstätten".
    await expect(page.getByText("Weitere Werkstätten")).toBeVisible()
    const checkoutBtn = page.getByRole("button", { name: "Zum Checkout" })
    await checkoutBtn.scrollIntoViewIfNeeded()
    await checkoutBtn.click()
    await expect(page.getByText("Dein Besuch")).toBeVisible()

    // Mixed cart: Vereinsmitgliedschaft sits above and the three regular
    // buckets stay visible.
    await expect(
      page.getByRole("button", { name: /Vereinsmitgliedschaft/ }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: /Nutzungsgebühren/ }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: /Materialbezug/ }),
    ).toBeVisible()

    await expect(page).toHaveScreenshot("checkout-summary-membership-mixed.png")

    await clearCheckoutsDeep()
  })

  test("workshops step — Vereinsmitgliedschaft inline (no add button, no Diverses)", async ({
    page,
  }) => {
    const uid = process.env.E2E_AUTH_USER_UID
    test.skip(!uid, "E2E_AUTH_USER_UID not set (global-setup did not run)")
    await signIn(page)
    await seedOpenCheckoutWithMembership(uid!)

    // The seeded open-checkout-from-today's wizard step is /visit (the
    // workshops step). Navigate there directly rather than via the `/`
    // dispatcher (see the membership-only summary test above).
    await page.goto("/visit")

    // The inline Vereinsmitgliedschaft block renders, but the workshop
    // picker grid, the "Material hinzufügen" affordance, and any Diverses
    // heading are all absent for a membership-only cart.
    await expect(page.getByTestId("membership-block")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText("Werkstätten wählen")).toBeHidden()
    await expect(
      page.getByRole("button", { name: "Material hinzufügen" }),
    ).toBeHidden()
    await expect(page.getByText("Diverses")).toBeHidden()

    await expect(page).toHaveScreenshot(
      "checkout-workshops-membership-only.png",
    )

    await clearCheckoutsDeep()
  })
})
