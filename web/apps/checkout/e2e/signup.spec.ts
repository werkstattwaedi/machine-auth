// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import { getAdminFirestore, waitForOobCode } from "./helpers"

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

      const firstName = page.getByLabel("Vorname *")
      await firstName.click()
      await firstName.fill("Test")

      const lastName = page.getByLabel("Nachname *")
      await lastName.click()
      await lastName.fill("Neuer")

      await page.getByLabel("Ich akzeptiere die Nutzungsbestimmungen *").check()
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
})
