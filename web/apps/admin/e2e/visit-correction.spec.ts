// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Admin corrections (ADR-0041): pure cancellation, corrected re-issue with
// a revision suffix, paid bills hiding the actions, and the Sammelrechnung
// batch editor. Seeds its own fixtures in beforeAll and runs in the
// "corrections" Playwright project AFTER the screenshot specs — these
// tests mutate visits and bills, so the list baselines must never see a
// mid-flight state. The functions emulator executes the real callable
// (PDFs land in the Storage emulator; mail is skipped in emulator mode).

import { test, expect } from "@playwright/test"
import { Timestamp } from "firebase-admin/firestore"
import { getAdminFirestore, signInWithEmailCode } from "./helpers"
import { ADMIN_EMAIL, SEEDED_DIRECTORY_USERS } from "./global-setup"

const ANNA = SEEDED_DIRECTORY_USERS[0].id
const VISIT_CORRECT_ID = "e2e-visit-correct"
const BILL_CORRECT_ID = "e2e-bill-correct" // 20500 → RE-002050
const VISIT_CANCEL_ID = "e2e-visit-cancel"
const BILL_CANCEL_ID = "e2e-bill-cancel" // 20700 → RE-002070
const VISIT_PAID_ID = "e2e-visit-paid"
const BILL_PAID_VISIT_ID = "e2e-bill-paid-visit" // 20800
const SAMMEL_ID = "e2e-sammel" // 20600 → RE-002060
const BELEG_A_ID = "e2e-beleg-a" // 20610 → BL-002061
const BELEG_B_ID = "e2e-beleg-b" // 20620 → BL-002062
const VISIT_BELEG_A_ID = "e2e-visit-beleg-a"
const VISIT_BELEG_B_ID = "e2e-visit-beleg-b"

function ts(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso))
}

/** A closed visit for Anna with one material line (0.5 × CHF 56 by default). */
async function seedVisit(
  id: string,
  billId: string,
  opts: { created: string; paymentMethod?: "rechnung" | "monthly"; materialQty?: number },
): Promise<number> {
  const db = getAdminFirestore()
  const annaRef = db.doc(`users/${ANNA}`)
  const qty = opts.materialQty ?? 0.5
  const material = qty * 56
  const total = 15 + material
  const ref = db.collection("checkouts").doc(id)
  await ref.set({
    userId: annaRef,
    status: "closed",
    usageType: "regular",
    created: ts(opts.created),
    closedAt: ts(opts.created),
    workshopsVisited: ["holz"],
    persons: [
      {
        name: "Anna Architektin",
        email: "anna@werkstattwaedi.ch",
        userType: "erwachsen",
        userRef: annaRef,
      },
    ],
    billRef: db.doc(`bills/${billId}`),
    paymentMethod: opts.paymentMethod ?? "rechnung",
    summary: {
      totalPrice: total,
      entryFees: 15,
      machineCost: 0,
      materialCost: material,
      tip: 0,
      discountAmount: 0,
    },
    modifiedBy: null,
    modifiedAt: ts(opts.created),
  })
  await ref.collection("items").doc("item-material").set({
    workshop: "holz",
    description: "Ahorn 30 mm",
    origin: "manual",
    catalogId: null,
    created: ts(opts.created),
    quantity: qty,
    unitPrice: 56,
    totalPrice: material,
  })
  return total
}

async function seedBill(
  id: string,
  opts: {
    checkoutIds: string[]
    referenceNumber: number
    amount: number
    kind?: "invoice" | "beleg"
    aggregatedInto?: string
    paid?: boolean
    acked?: "user" | "auto" | null
  },
): Promise<void> {
  const db = getAdminFirestore()
  await db
    .collection("bills")
    .doc(id)
    .set({
      userId: db.doc(`users/${ANNA}`),
      checkouts: opts.checkoutIds.map((c) => db.doc(`checkouts/${c}`)),
      referenceNumber: opts.referenceNumber,
      amount: opts.amount,
      currency: "CHF",
      storagePath: null,
      created: ts("2026-07-01T10:00:00Z"),
      paidAt: opts.paid ? ts("2026-07-05T10:00:00Z") : null,
      paidVia: opts.paid ? "ebanking" : null,
      // Pre-set so the onBillCreate side-effect chain treats them as done.
      pdfGeneratedAt: ts("2026-07-01T10:05:00Z"),
      emailSentAt: ts("2026-07-01T10:05:00Z"),
      paymentMethodConfirmationTime: opts.acked ? ts("2026-07-01T10:06:00Z") : null,
      paymentMethodConfirmationSource: opts.acked ?? null,
      kind: opts.kind ?? "invoice",
      aggregatedIntoBillRef: opts.aggregatedInto ? db.doc(`bills/${opts.aggregatedInto}`) : null,
      source: "checkout",
    })
}

test.describe("visit corrections (ADR-0041)", () => {
  test.beforeAll(async () => {
    const db = getAdminFirestore()
    // The callable prices the replacement server-side and the editor
    // estimates client-side; both need the standard fees + workshops.
    await db.doc("config/pricing").set({
      entryFees: {
        erwachsen: { regular: 15 },
        kind: { regular: 7.5 },
        firma: { regular: 30 },
      },
      slaLayerPrice: { none: 0.01, member: 0.008 },
      workshops: {
        holz: { label: "Holz", order: 1 },
        metall: { label: "Metall", order: 2 },
      },
      labels: {
        units: { h: "Std.", m2: "m²", m: "m", stk: "Stk.", kg: "kg", chf: "CHF" },
        discounts: { none: "Normal", member: "Mitglied" },
      },
    })
    await db
      .doc("config/billing")
      .set({ nextBillNumber: 3000, referenceNumberFormat: "shifted-v1" }, { merge: true })

    const correctTotal = await seedVisit(VISIT_CORRECT_ID, BILL_CORRECT_ID, {
      created: "2026-07-01T09:00:00Z",
    })
    await seedBill(BILL_CORRECT_ID, {
      checkoutIds: [VISIT_CORRECT_ID],
      referenceNumber: 20500,
      amount: correctTotal,
      acked: "user",
    })
    const cancelTotal = await seedVisit(VISIT_CANCEL_ID, BILL_CANCEL_ID, {
      created: "2026-07-02T09:00:00Z",
    })
    await seedBill(BILL_CANCEL_ID, {
      checkoutIds: [VISIT_CANCEL_ID],
      referenceNumber: 20700,
      amount: cancelTotal,
      acked: "user",
    })
    const paidTotal = await seedVisit(VISIT_PAID_ID, BILL_PAID_VISIT_ID, {
      created: "2026-07-03T09:00:00Z",
    })
    await seedBill(BILL_PAID_VISIT_ID, {
      checkoutIds: [VISIT_PAID_ID],
      referenceNumber: 20800,
      amount: paidTotal,
      acked: "user",
      paid: true,
    })
    // A sent Sammelrechnung with two aggregated Belege.
    const belegA = await seedVisit(VISIT_BELEG_A_ID, BELEG_A_ID, {
      created: "2026-06-10T09:00:00Z",
      paymentMethod: "monthly",
    })
    const belegB = await seedVisit(VISIT_BELEG_B_ID, BELEG_B_ID, {
      created: "2026-06-20T09:00:00Z",
      paymentMethod: "monthly",
      materialQty: 1,
    })
    await seedBill(BELEG_A_ID, {
      checkoutIds: [VISIT_BELEG_A_ID],
      referenceNumber: 20610,
      amount: belegA,
      kind: "beleg",
      aggregatedInto: SAMMEL_ID,
    })
    await seedBill(BELEG_B_ID, {
      checkoutIds: [VISIT_BELEG_B_ID],
      referenceNumber: 20620,
      amount: belegB,
      kind: "beleg",
      aggregatedInto: SAMMEL_ID,
    })
    await seedBill(SAMMEL_ID, {
      checkoutIds: [VISIT_BELEG_A_ID, VISIT_BELEG_B_ID],
      referenceNumber: 20600,
      amount: belegA + belegB,
      acked: "auto",
    })
  })

  test("pure cancellation voids the visit and its bill", async ({ page }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/visits/${VISIT_CANCEL_ID}`)
    await expect(page.getByText("Ahorn 30 mm")).toBeVisible()

    await page.getByRole("button", { name: "Stornieren" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Grund").fill("Doppelt erfasst")
    await dialog.getByRole("button", { name: "Stornieren" }).click()

    await expect(page.getByTestId("visit-cancelled-banner")).toContainText("Doppelt erfasst")
    await expect(page.getByText("storniert", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Stornieren" })).toHaveCount(0)

    const db = getAdminFirestore()
    const checkout = await db.doc(`checkouts/${VISIT_CANCEL_ID}`).get()
    expect(checkout.get("status")).toBe("cancelled")
    expect(checkout.get("supersededByCheckoutRef")).toBeNull()
    const bill = await db.doc(`bills/${BILL_CANCEL_ID}`).get()
    expect(bill.get("cancelledAt")).toBeTruthy()

    // Bill detail: storniert, no mark-paid.
    await page.goto(`/invoices/${BILL_CANCEL_ID}`)
    await expect(page.getByRole("heading", { name: "RE-002070" })).toBeVisible()
    await expect(page.getByText("storniert", { exact: true })).toBeVisible()
    await expect(page.getByText("Doppelt erfasst")).toBeVisible()
    await expect(page.getByRole("button", { name: "Als bezahlt markieren" })).toHaveCount(0)
  })

  test("correction re-issues the bill with a revision suffix", async ({ page }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/visits/${VISIT_CORRECT_ID}`)
    await page.getByRole("link", { name: "Korrigieren" }).click()
    await page.waitForURL((url) => url.pathname === `/visits/${VISIT_CORRECT_ID}/correct`)

    // 0.5 → 1 m of Ahorn: 15 + 56 = CHF 71.00 instead of CHF 43.00.
    await page.getByLabel("Menge Position 1").fill("1")
    await expect(page.getByText("CHF 71.00")).toBeVisible()
    await page.getByLabel("Grund der Korrektur").fill("Menge korrigiert")
    await page.getByRole("button", { name: "Stornieren und neu ausstellen" }).click()
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Stornieren und neu ausstellen" })
      .click()

    // Lands on the replacement visit.
    await page.waitForURL(
      (url) => /^\/visits\/[^/]+$/.test(url.pathname) && !url.pathname.includes(VISIT_CORRECT_ID),
    )
    await expect(page.getByTestId("visit-replacement-banner")).toContainText(
      "Korrektur des Besuchs",
    )
    await expect(page.getByText("RE-002050-2")).toBeVisible()
    // Summe line + Abrechnung total both show the new amount.
    await expect(page.getByText("CHF 71.00").first()).toBeVisible()

    const db = getAdminFirestore()
    const original = await db.doc(`checkouts/${VISIT_CORRECT_ID}`).get()
    expect(original.get("status")).toBe("cancelled")
    const replacementRef = original.get("supersededByCheckoutRef")
    expect(replacementRef).toBeTruthy()
    const newBills = await db
      .collection("bills")
      .where("supersedesBillRef", "==", db.doc(`bills/${BILL_CORRECT_ID}`))
      .get()
    expect(newBills.size).toBe(1)
    expect(newBills.docs[0].get("referenceNumber")).toBe(20501)
    expect(newBills.docs[0].get("amount")).toBe(71)

    // List: original storniert, revision offen.
    await page.goto("/invoices")
    await expect(page.getByRole("cell", { name: "RE-002050-2", exact: true })).toBeVisible()
    await expect(page.getByRole("row", { name: /^RE-002050 / })).toContainText("storniert")

    // Original bill points at its replacement.
    await page.goto(`/invoices/${BILL_CORRECT_ID}`)
    await expect(page.getByText("Ersetzt durch")).toBeVisible()
    await expect(page.getByRole("link", { name: "RE-002050-2" })).toBeVisible()
  })

  test("a paid bill hides the correction actions", async ({ page }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/visits/${VISIT_PAID_ID}`)
    await expect(page.getByText("Ahorn 30 mm")).toBeVisible()
    await expect(page.getByRole("link", { name: "Korrigieren" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Stornieren" })).toHaveCount(0)
  })

  test("Sammelrechnung batch: two Belege corrected in one commit yield one revision", async ({
    page,
  }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/invoices/${SAMMEL_ID}`)
    await page.getByRole("link", { name: "Belege korrigieren" }).click()
    await page.waitForURL((url) => url.pathname === `/invoices/${SAMMEL_ID}/correct`)

    await page.getByRole("button", { name: "BL-002061 bearbeiten" }).click()
    await page.getByTestId(`beleg-card-${BELEG_A_ID}`).getByLabel("Menge Position 1").fill("1")
    await page.getByRole("button", { name: "BL-002062 bearbeiten" }).click()
    await page.getByTestId(`beleg-card-${BELEG_B_ID}`).getByLabel("Menge Position 1").fill("2")
    await expect(page.getByText("2 von 2 Belegen geändert")).toBeVisible()

    await page.getByLabel("Grund der Korrektur").fill("Mengen im Juni korrigiert")
    await page.getByRole("button", { name: "Sammelrechnung neu ausstellen" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Neu ausstellen" }).click()

    await page.waitForURL(
      (url) =>
        url.pathname.startsWith("/invoices/") &&
        !url.pathname.includes(SAMMEL_ID) &&
        !url.pathname.endsWith("/correct"),
    )
    await expect(page.getByRole("heading", { name: "RE-002060-2" })).toBeVisible()
    // (15 + 56) + (15 + 112)
    await expect(page.getByText("CHF 198.00")).toBeVisible()

    const db = getAdminFirestore()
    const revisions = await db
      .collection("bills")
      .where("supersedesBillRef", "==", db.doc(`bills/${SAMMEL_ID}`))
      .get()
    expect(revisions.size).toBe(1)
    const revision = revisions.docs[0]
    expect(revision.get("correctedBillRefs")).toHaveLength(2)
    expect((await db.doc(`bills/${SAMMEL_ID}`).get()).get("cancelledAt")).toBeTruthy()
    expect((await db.doc(`bills/${BELEG_A_ID}`).get()).get("cancelledAt")).toBeTruthy()
    const replacements = await db
      .collection("bills")
      .where("aggregatedIntoBillRef", "==", revision.ref)
      .get()
    expect(replacements.size).toBe(2)
  })
})
