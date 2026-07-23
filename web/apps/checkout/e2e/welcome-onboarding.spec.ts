// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// End-to-end for the imported-member "Willkommen" onboarding (design handoff
// "Welcome-Dialog Erstanmeldung", variant 2b). Seeds a member exactly as
// scripts/import-members.ts leaves them — an Auth user + users doc with
// `termsAcceptedAt: null` (the unclaimed sentinel) + an active membership —
// then logs in with an email code and walks the blocking 4-step dialog:
// Willkommen → Deine Daten (prefilled) → Nutzungsbestimmungen → Wo finde ich
// was. Regression net for the launch bug where imported members were
// misrouted into a fresh "Konto erstellen" sign-up.

import { test, expect } from "@playwright/test"
import { Timestamp } from "firebase-admin/firestore"
import {
  clearCollections,
  getAdminAuth,
  getAdminFirestore,
  waitForLoginCode,
} from "./helpers"

const IMPORTED_EMAIL = "imported-member@werkstattwaedi.ch"
const IMPORTED_UID = "e2e-imported-member-001"
const IMPORTED_MEMBERSHIP_ID = "e2e-imported-membership-001"
// Stable future date so the "gültig bis" line is deterministic.
const VALID_UNTIL = new Date("2027-01-31T12:00:00Z")

test.describe("Imported-member welcome onboarding", () => {
  test.beforeEach(async () => {
    await clearCollections("loginCodes")
    const db = getAdminFirestore()
    const auth = await getAdminAuth()

    // Fresh Auth user with a pinned UID (matches the users doc id, like the
    // import script). Recreate to reset any prior terms acceptance.
    await auth.deleteUser(IMPORTED_UID).catch(() => undefined)
    await auth.createUser({
      uid: IMPORTED_UID,
      email: IMPORTED_EMAIL,
      emailVerified: true,
    })

    const userRef = db.collection("users").doc(IMPORTED_UID)
    const membershipRef = db
      .collection("memberships")
      .doc(IMPORTED_MEMBERSHIP_ID)

    // Imported family membership (drives the Familie badge + step-4 card).
    await membershipRef.set({
      type: "family",
      status: "active",
      lastPaidAt: Timestamp.fromDate(
        new Date(VALID_UNTIL.getTime() - 365 * 24 * 60 * 60 * 1000),
      ),
      validUntil: Timestamp.fromDate(VALID_UNTIL),
      ownerUserId: userRef,
      members: [userRef],
      paymentCheckouts: [],
      created: Timestamp.now(),
    })

    // Unclaimed member doc: real profile data, terms NOT yet accepted.
    await userRef.set({
      firstName: "Franziska",
      lastName: "Imported",
      email: IMPORTED_EMAIL,
      phone: "+41792489428",
      roles: [],
      permissions: [],
      userType: "erwachsen",
      termsAcceptedAt: null,
      billingAddress: {
        company: "",
        street: "Johanniterstrasse 3",
        zip: "8820",
        city: "Wädenswil",
      },
      activeMembership: membershipRef,
      created: Timestamp.now(),
    })
  })

  test("logs in with a code and completes the 4-step welcome dialog", async ({
    page,
  }) => {
    // ── Sign in via email code (existing account → code-only, no sign-up) ──
    await page.goto("/login")
    await page.getByTestId("login-email-input").fill(IMPORTED_EMAIL)
    await page.getByTestId("login-email-submit").click()

    await expect(page.getByTestId("login-code-stage")).toBeVisible()
    // The fix: an imported member is NOT offered a fresh sign-up form.
    await expect(page.getByTestId("signup-firstname")).not.toBeVisible()

    const entry = await waitForLoginCode(IMPORTED_EMAIL)
    expect(entry, "debugCode should be present in emulator").toBeTruthy()
    await page.getByTestId("login-code-input").fill(entry!.code)
    await page.getByTestId("login-code-submit").click()

    // ── Step 1 · Willkommen ──
    const dialog = page.getByTestId("welcome-onboarding-dialog")
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(
      dialog.getByText("Willkommen im neuen Self-Checkout, Franziska"),
    ).toBeVisible()
    await page.getByTestId("welcome-next").click()

    // ── Step 2 · Deine Daten (prefilled from the import) ──
    await expect(page.getByTestId("welcome-firstname")).toHaveValue("Franziska")
    await expect(page.getByTestId("welcome-lastname")).toHaveValue("Imported")
    await expect(page.getByTestId("welcome-phone")).toHaveValue("+41792489428")
    await expect(dialog.getByText("Familie")).toBeVisible()
    await expect(dialog.getByText(/gültig bis/)).toBeVisible()
    await page.getByTestId("welcome-next").click()

    // ── Step 3 · Nutzungsbestimmungen (gated on the checkbox) ──
    await expect(
      dialog.getByRole("heading", { name: "Nutzungsbestimmungen", exact: true }),
    ).toBeVisible()
    // Advancing unchecked shows the error and does not proceed.
    await page.getByTestId("welcome-next").click()
    await expect(page.getByTestId("welcome-terms-error")).toBeVisible()
    // Checking clears the error; then we can advance.
    await page.getByTestId("welcome-terms").click()
    await expect(page.getByTestId("welcome-terms-error")).not.toBeVisible()
    await page.getByTestId("welcome-next").click()

    // ── Step 4 · Wo finde ich was? ──
    await expect(
      dialog.getByRole("heading", { name: "Wo finde ich was?", exact: true }),
    ).toBeVisible()
    // Family card link → the real membership page, in a new tab.
    const membershipLink = dialog.getByRole("link", { name: "«Mitgliedschaft»" })
    await expect(membershipLink).toHaveAttribute("href", "/account/membership")
    await expect(membershipLink).toHaveAttribute("target", "_blank")
    // Resource links open in a new tab.
    const preisliste = dialog.getByRole("link", { name: /Preisliste/ })
    await expect(preisliste).toHaveAttribute("target", "_blank")

    // Complete → leaves the dialog, lands in the app (not login/complete-profile).
    await page.getByTestId("welcome-next").click()
    await expect(dialog).not.toBeVisible({ timeout: 10_000 })
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).not.toHaveURL(/complete-profile/)

    // ── Firestore: terms now recorded, membership + address preserved ──
    const db = getAdminFirestore()
    let doc = await db.collection("users").doc(IMPORTED_UID).get()
    for (let i = 0; i < 10 && !doc.get("termsAcceptedAt"); i++) {
      await new Promise((r) => setTimeout(r, 300))
      doc = await db.collection("users").doc(IMPORTED_UID).get()
    }
    expect(doc.get("termsAcceptedAt"), "termsAcceptedAt recorded").toBeTruthy()
    // The imported address must survive onboarding (regression: the old
    // sign-up path nulled it for non-firma members).
    expect(doc.get("billingAddress")?.street).toBe("Johanniterstrasse 3")
    expect(doc.get("activeMembership")).toBeTruthy()
  })

  test("a firma member can complete onboarding (company + address required)", async ({
    page,
  }) => {
    // Regression: a firma member has no company field in the old dialog, so
    // isProfileComplete could never flip true → permanent onboarding loop.
    // Reshape the seeded member to firma with an empty company/address.
    const db = getAdminFirestore()
    await db.collection("users").doc(IMPORTED_UID).set(
      {
        userType: "firma",
        billingAddress: { company: "", street: "", zip: "", city: "" },
      },
      { merge: true },
    )

    await page.goto("/login")
    await page.getByTestId("login-email-input").fill(IMPORTED_EMAIL)
    await page.getByTestId("login-email-submit").click()
    await expect(page.getByTestId("login-code-stage")).toBeVisible()
    const entry = await waitForLoginCode(IMPORTED_EMAIL)
    await page.getByTestId("login-code-input").fill(entry!.code)
    await page.getByTestId("login-code-submit").click()

    // Step 1 → Step 2
    const dialog = page.getByTestId("welcome-onboarding-dialog")
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await page.getByTestId("welcome-next").click()

    // The firma-only company field is present and required.
    await expect(page.getByTestId("welcome-company")).toBeVisible()
    await page.getByTestId("welcome-next").click()
    await expect(dialog.getByText("Firmenname ist erforderlich")).toBeVisible()

    // Fill company + full address, then proceed through terms.
    await page.getByTestId("welcome-company").fill("Muster AG")
    await page.getByTestId("welcome-street").fill("Bahnhofstrasse 1")
    await page.getByTestId("welcome-zip").fill("8820")
    await page.getByTestId("welcome-city").fill("Wädenswil")
    await page.getByTestId("welcome-next").click()

    await expect(
      dialog.getByRole("heading", { name: "Nutzungsbestimmungen", exact: true }),
    ).toBeVisible()
    await page.getByTestId("welcome-terms").click()
    await page.getByTestId("welcome-next").click() // → step 4
    await page.getByTestId("welcome-next").click() // → Zum Check-in

    await expect(dialog).not.toBeVisible({ timeout: 10_000 })

    // The firma profile is now complete: company persisted + terms recorded.
    let doc = await db.collection("users").doc(IMPORTED_UID).get()
    for (let i = 0; i < 10 && !doc.get("termsAcceptedAt"); i++) {
      await new Promise((r) => setTimeout(r, 300))
      doc = await db.collection("users").doc(IMPORTED_UID).get()
    }
    expect(doc.get("termsAcceptedAt"), "termsAcceptedAt recorded").toBeTruthy()
    expect(doc.get("billingAddress")?.company).toBe("Muster AG")
    expect(doc.get("billingAddress")?.city).toBe("Wädenswil")
  })
})
