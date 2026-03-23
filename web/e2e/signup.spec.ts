// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { getAdminFirestore, getAuthOobCodes } from "./helpers"

const SIGNUP_EMAIL = "new-signup@werkstattwaedi.ch"

test.describe("Self-registration", () => {
  test("new user signs up, completes profile, and has no roles", async ({ page }) => {
    // ── Sign in via /login with a fresh email ──
    await page.goto("/login")
    await page.getByPlaceholder("deine@email.ch").fill(SIGNUP_EMAIL)
    await page
      .getByRole("button", { name: "Anmelde-Link senden" })
      .click()

    await expect(
      page.getByText("Anmelde-Link wurde an"),
    ).toBeVisible({ timeout: 5000 })

    // Fetch sign-in link from Auth emulator
    const oobCodes = await getAuthOobCodes()
    const signInCode = oobCodes.find(
      (c) =>
        c.email === SIGNUP_EMAIL &&
        c.requestType === "EMAIL_SIGNIN",
    )
    expect(signInCode).toBeTruthy()

    // Complete sign-in — handleSignIn() creates the user doc
    await page.goto(signInCode!.oobLink)

    // ── Should be redirected to /complete-profile ──
    await page.waitForURL("**/complete-profile", { timeout: 10_000 })
    await expect(
      page.getByRole("button", { name: "Profil speichern" }),
    ).toBeVisible()

    // ── Fill in profile details ──
    // Clear and fill to avoid race with React re-render
    const firstName = page.getByLabel("Vorname *")
    await firstName.click()
    await firstName.fill("Test")

    const lastName = page.getByLabel("Nachname *")
    await lastName.click()
    await lastName.fill("Neuer")

    // Accept terms
    await page.getByLabel("Ich akzeptiere die Nutzungsbestimmungen *").check()

    // Submit
    await page.getByRole("button", { name: "Profil speichern" }).click()

    // ── Should redirect to home after profile completion ──
    await page.waitForURL((url) => !url.pathname.includes("complete-profile"), {
      timeout: 10_000,
    })

    // ── Verify Firestore: user has no roles, profile data saved ──
    const db = getAdminFirestore()
    const snap = await db
      .collection("users")
      .where("email", "==", SIGNUP_EMAIL)
      .get()

    expect(snap.size).toBe(1)
    const userDoc = snap.docs[0].data()

    expect(userDoc.roles).toEqual([])
    expect(userDoc.firstName).toBe("Test")
    expect(userDoc.lastName).toBe("Neuer")
    expect(userDoc.termsAcceptedAt).toBeTruthy()
  })
})
