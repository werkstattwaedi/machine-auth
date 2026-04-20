// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { getAdminFirestore, waitForOobCode } from "./helpers"

const SIGNUP_EMAIL = "new-signup@werkstattwaedi.ch"
const CHECKOUT_SIGNUP_EMAIL = "checkout-signup@werkstattwaedi.ch"

// Only wipe the docs for the signup-specific emails — the seeded `e2e-test`
// and `NFC` users are required by sibling spec files that run after signup.
test.beforeEach(async () => {
  const db = getAdminFirestore()
  const emails = [SIGNUP_EMAIL, CHECKOUT_SIGNUP_EMAIL]
  for (const email of emails) {
    const snap = await db.collection("users").where("email", "==", email).get()
    if (snap.empty) continue
    const batch = db.batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
})

test.describe("Self-registration", () => {
  test("new user signs up, completes profile, and has no roles", async ({ page }) => {
    // ── Sign in via /login with a fresh email ──
    await page.goto("/login")

    // On the signup page (or login page), the switch link is visible while the
    // form is shown.
    await expect(page.getByText("Noch kein Konto?")).toBeVisible()

    await page.getByPlaceholder("deine@email.ch").fill(SIGNUP_EMAIL)
    await page
      .getByRole("button", { name: "Anmelde-Link senden" })
      .click()

    await expect(
      page.getByText("Anmelde-Link wurde an"),
    ).toBeVisible({ timeout: 5000 })

    // Regression (#103): the account-switch link must disappear once the
    // sign-in link has been sent — it's confusing to offer "Bereits
    // registriert? Anmelden" on the confirmation screen.
    await expect(page.getByText("Bereits registriert?")).not.toBeVisible()
    await expect(page.getByText("Noch kein Konto?")).not.toBeVisible()

    // Fetch sign-in link from Auth emulator
    const signInCode = await waitForOobCode(
      (c) => c.email === SIGNUP_EMAIL && c.requestType === "EMAIL_SIGNIN",
    )
    expect(signInCode).toBeTruthy()

    // Complete sign-in — handleSignIn() creates the user doc
    await page.goto(signInCode!.oobLink)

    // ── Should be redirected to /complete-profile ──
    // On fast environments the createUser Cloud Function may set termsAcceptedAt
    // before the client-side redirect check runs, skipping the profile page.
    // Accept both paths: /complete-profile or direct to /visit.
    await page.waitForURL(
      (url) => url.pathname.includes("/complete-profile") || url.pathname.includes("/visit"),
      { timeout: 10_000 },
    )

    if (page.url().includes("/complete-profile")) {
      await expect(
        page.getByRole("button", { name: "Profil speichern" }),
      ).toBeVisible()

      const firstName = page.locator("#firstName")
      await firstName.click()
      await firstName.fill("Test")

      const lastName = page.locator("#lastName")
      await lastName.click()
      await lastName.fill("Neuer")

      await page.locator("#termsAccepted").click()
      await page.getByRole("button", { name: "Profil speichern" }).click()

      await page.waitForURL((url) => !url.pathname.includes("complete-profile"), {
        timeout: 10_000,
      })
    }

    // ── Verify Firestore: user exists with no roles ──
    // Wait briefly for the createUser Cloud Function to write the doc
    const db = getAdminFirestore()
    let snap = await db.collection("users").where("email", "==", SIGNUP_EMAIL).get()
    for (let i = 0; i < 10 && snap.empty; i++) {
      await new Promise((r) => setTimeout(r, 300))
      snap = await db.collection("users").where("email", "==", SIGNUP_EMAIL).get()
    }

    expect(snap.size).toBe(1)
    const userDoc = snap.docs[0].data()

    expect(userDoc.roles).toEqual([])
    expect(userDoc.email).toBe(SIGNUP_EMAIL)
  })

  test("new user creates account from checkout page, completes profile, lands on visit", async ({ page }) => {
    // ── Start at checkout page ──
    await page.goto("/")
    await expect(page.getByText("Deine Angaben")).toBeVisible({ timeout: 10_000 })

    // ── Click "Registrieren" in the identity hint ──
    await page.getByRole("button", { name: "Registrieren" }).click()

    // ── Should be on /login with mode=signup ──
    await page.waitForURL((url) => url.pathname === "/login", { timeout: 5_000 })
    await expect(page.getByText("Konto erstellen")).toBeVisible()

    // In signup mode, the "already registered" switch link is visible.
    await expect(page.getByText("Bereits registriert?")).toBeVisible()

    // ── Send sign-in link ──
    await page.getByPlaceholder("deine@email.ch").fill(CHECKOUT_SIGNUP_EMAIL)
    await page.getByRole("button", { name: "Anmelde-Link senden" }).click()
    await expect(page.getByText("Anmelde-Link wurde an")).toBeVisible({ timeout: 5_000 })

    // Regression (#103): once the link has been sent, the "Bereits
    // registriert? Anmelden" switch link must no longer be shown.
    await expect(page.getByText("Bereits registriert?")).not.toBeVisible()

    // ── Complete email link sign-in ──
    const signInCode = await waitForOobCode(
      (c) => c.email === CHECKOUT_SIGNUP_EMAIL && c.requestType === "EMAIL_SIGNIN",
    )
    expect(signInCode).toBeTruthy()
    await page.goto(signInCode!.oobLink)

    // ── Should land on /complete-profile (signup mode forces this) ──
    await page.waitForURL(
      (url) => url.pathname.includes("/complete-profile"),
      { timeout: 10_000 },
    )

    // ── Profile page should NOT have a sidebar ──
    await expect(page.getByRole("button", { name: "Profil speichern" })).toBeVisible()
    await expect(page.getByText("Aktueller Besuch")).not.toBeVisible()
    await expect(page.getByText("Nutzungsverlauf")).not.toBeVisible()

    // ── Screenshot: empty complete-profile form ──
    await expect(page).toHaveScreenshot("complete-profile-empty.png")

    // ── Regression (#111): labels should not show required-field asterisks.
    // All fields on the complete-profile form are required, so marking them
    // individually with "*" is redundant and visually noisy.
    const formText = await page.locator("form").innerText()
    expect(formText).not.toContain("*")

    // ── Regression (#110): the Nutzungsbestimmungen link is inlined in the
    // checkbox label (not a separate header row). Clicking the link must
    // open the terms in a new tab without toggling the checkbox.
    const termsLink = page.getByRole("link", { name: "Nutzungsbestimmungen" })
    await expect(termsLink).toHaveAttribute(
      "href",
      "https://werkstattwaedi.ch/nutzungsbestimmungen",
    )
    await expect(termsLink).toHaveAttribute("target", "_blank")
    const termsCheckbox = page.locator("#termsAccepted")
    await expect(termsCheckbox).not.toBeChecked()
    // Intercept the link click to prevent actual navigation, verify the
    // checkbox state is unaffected by the click (stopPropagation keeps the
    // label-click-forwarding from toggling the checkbox).
    await termsLink.evaluate((a) =>
      a.addEventListener("click", (e) => e.preventDefault()),
    )
    await termsLink.click()
    await expect(termsCheckbox).not.toBeChecked()

    // ── Complete the profile ──
    await page.locator("#firstName").fill("Checkout")
    await page.locator("#lastName").fill("Tester")
    await page.locator("#termsAccepted").click()
    await page.getByRole("button", { name: "Profil speichern" }).click()

    // ── Should arrive at /visit (signup mode default target) ──
    await page.waitForURL(
      (url) => url.pathname.includes("/visit"),
      { timeout: 10_000 },
    )

    // ── Verify Firestore ──
    const db = getAdminFirestore()
    let snap = await db.collection("users").where("email", "==", CHECKOUT_SIGNUP_EMAIL).get()
    for (let i = 0; i < 10 && snap.empty; i++) {
      await new Promise((r) => setTimeout(r, 300))
      snap = await db.collection("users").where("email", "==", CHECKOUT_SIGNUP_EMAIL).get()
    }
    expect(snap.size).toBe(1)
    const userDoc = snap.docs[0].data()
    expect(userDoc.firstName).toBe("Checkout")
    expect(userDoc.lastName).toBe("Tester")
    expect(userDoc.roles).toEqual([])
  })
})
