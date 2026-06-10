// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { clearCollections, getAdminFirestore, waitForLoginCode } from "./helpers"

const SIGNUP_EMAIL = "new-signup@werkstattwaedi.ch"
const CHECKOUT_SIGNUP_EMAIL = "checkout-signup@werkstattwaedi.ch"
// Distinct email — reusing SIGNUP_EMAIL here would trip the 60s per-email
// code-request rate limit set by the first test.
const FIRMA_SIGNUP_EMAIL = "firma-signup@werkstattwaedi.ch"

// Only wipe the docs for the signup-specific emails — the seeded `e2e-test`
// and `NFC` users are required by sibling spec files that run after signup.
test.beforeEach(async () => {
  // Clear prior codes so the 60s per-email rate limit doesn't flake across the
  // chromium → mobile-chrome project boundary (same emails are reused).
  await clearCollections("loginCodes")
  const db = getAdminFirestore()
  const emails = [SIGNUP_EMAIL, CHECKOUT_SIGNUP_EMAIL, FIRMA_SIGNUP_EMAIL]
  for (const email of emails) {
    const snap = await db.collection("users").where("email", "==", email).get()
    if (snap.empty) continue
    const batch = db.batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
})

test.describe("Self-registration (combined sign-in/sign-up)", () => {
  test("new user signs up inline and has no roles", async ({ page }) => {
    // ── Combined login: enter a fresh email ──
    await page.goto("/login")
    await expect(page.getByText("Anmelden oder Konto erstellen")).toBeVisible()

    await page.getByTestId("login-email-input").fill(SIGNUP_EMAIL)
    await page.getByTestId("login-email-submit").click()

    // A new email branches straight to the inline sign-up form (not the
    // code-only sign-in stage).
    await expect(page.getByTestId("login-signup-stage")).toBeVisible({
      timeout: 5000,
    })
    await expect(page.getByTestId("login-code-stage")).not.toBeVisible()

    // Fill name + the inline 6-digit code (read from the emulator) + terms.
    const entry = await waitForLoginCode(SIGNUP_EMAIL)
    expect(entry).toBeTruthy()
    await page.getByTestId("signup-firstname").fill("Test")
    await page.getByTestId("signup-lastname").fill("Neuer")
    await page.getByTestId("signup-code-input").fill(entry!.code)
    await page.getByTestId("signup-terms").click()

    // The Nutzungsbestimmungen link opens in a new tab (regression #110).
    const termsLink = page.getByRole("link", { name: "Nutzungsbestimmungen" })
    await expect(termsLink).toHaveAttribute(
      "href",
      "https://werkstattwaedi.ch/nutzungsbestimmungen",
    )
    await expect(termsLink).toHaveAttribute("target", "_blank")

    await page.getByTestId("signup-submit").click()

    // Lands away from /login (root dispatcher → /checkin for a fresh account).
    await page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 10_000,
    })

    // ── Verify Firestore: completed account, no roles ──
    const db = getAdminFirestore()
    let snap = await db.collection("users").where("email", "==", SIGNUP_EMAIL).get()
    for (let i = 0; i < 10 && snap.empty; i++) {
      await new Promise((r) => setTimeout(r, 300))
      snap = await db.collection("users").where("email", "==", SIGNUP_EMAIL).get()
    }
    expect(snap.size).toBe(1)
    const userDoc = snap.docs[0].data()
    expect(userDoc.email).toBe(SIGNUP_EMAIL)
    expect(userDoc.firstName).toBe("Test")
    expect(userDoc.lastName).toBe("Neuer")
    expect(userDoc.roles).toEqual([])
    expect(userDoc.termsAcceptedAt).toBeTruthy()
    // erwachsen sign-up carries no billing address.
    expect(userDoc.billingAddress ?? null).toBeNull()
  })

  test("new user creates an account from the checkout identity hint", async ({ page }) => {
    // ── Start at the checkout/check-in page ──
    await page.goto("/")
    await expect(page.getByText("Deine Angaben")).toBeVisible({ timeout: 10_000 })

    // ── Click the combined login link in the identity hint ──
    await page.getByRole("button", { name: "Anmelden oder registrieren" }).click()
    await page.waitForURL((url) => url.pathname === "/login", { timeout: 5_000 })
    await expect(page.getByText("Anmelden oder Konto erstellen")).toBeVisible()

    await page.getByTestId("login-email-input").fill(CHECKOUT_SIGNUP_EMAIL)
    await page.getByTestId("login-email-submit").click()

    await expect(page.getByTestId("login-signup-stage")).toBeVisible({
      timeout: 5_000,
    })

    const entry = await waitForLoginCode(CHECKOUT_SIGNUP_EMAIL)
    expect(entry).toBeTruthy()
    await page.getByTestId("signup-firstname").fill("Checkout")
    await page.getByTestId("signup-lastname").fill("Tester")
    await page.getByTestId("signup-code-input").fill(entry!.code)
    await page.getByTestId("signup-terms").click()
    await page.getByTestId("signup-submit").click()

    // ── Lands on /checkin (redirect=/ → dispatcher → start a checkout) ──
    await page.waitForURL((url) => url.pathname.includes("/checkin"), {
      timeout: 10_000,
    })

    // ── Verify Firestore ──
    const db = getAdminFirestore()
    let snap = await db
      .collection("users")
      .where("email", "==", CHECKOUT_SIGNUP_EMAIL)
      .get()
    for (let i = 0; i < 10 && snap.empty; i++) {
      await new Promise((r) => setTimeout(r, 300))
      snap = await db
        .collection("users")
        .where("email", "==", CHECKOUT_SIGNUP_EMAIL)
        .get()
    }
    expect(snap.size).toBe(1)
    const userDoc = snap.docs[0].data()
    expect(userDoc.firstName).toBe("Checkout")
    expect(userDoc.lastName).toBe("Tester")
    expect(userDoc.roles).toEqual([])
  })

  test("firma sign-up requires the inline billing address", async ({ page }) => {
    await page.goto("/login")
    await page.getByTestId("login-email-input").fill(FIRMA_SIGNUP_EMAIL)
    await page.getByTestId("login-email-submit").click()
    await expect(page.getByTestId("login-signup-stage")).toBeVisible({
      timeout: 5_000,
    })

    const entry = await waitForLoginCode(FIRMA_SIGNUP_EMAIL)
    await page.getByTestId("signup-firstname").fill("Firma")
    await page.getByTestId("signup-lastname").fill("Inhaber")
    await page.getByTestId("signup-code-input").fill(entry!.code)
    // The radio is visually hidden (sr-only) behind a styled label.
    await page.getByTestId("signup-membertype-firma").check({ force: true })

    // Address fields appear for firma.
    await expect(page.getByLabel("Strasse und Hausnummer")).toBeVisible()
    await page.getByLabel("Firmenname").fill("Holzbau Müller AG")
    await page.getByLabel("Strasse und Hausnummer").fill("Seestrasse 12")
    await page.getByLabel("PLZ").fill("8820")
    await page.getByLabel("Ort").fill("Wädenswil")
    await page.getByTestId("signup-terms").click()
    await page.getByTestId("signup-submit").click()

    await page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 10_000,
    })

    const db = getAdminFirestore()
    let snap = await db
      .collection("users")
      .where("email", "==", FIRMA_SIGNUP_EMAIL)
      .get()
    for (let i = 0; i < 10 && snap.empty; i++) {
      await new Promise((r) => setTimeout(r, 300))
      snap = await db
        .collection("users")
        .where("email", "==", FIRMA_SIGNUP_EMAIL)
        .get()
    }
    const userDoc = snap.docs[0].data()
    expect(userDoc.userType).toBe("firma")
    expect(userDoc.billingAddress?.company).toBe("Holzbau Müller AG")
    expect(userDoc.billingAddress?.city).toBe("Wädenswil")
  })
})
