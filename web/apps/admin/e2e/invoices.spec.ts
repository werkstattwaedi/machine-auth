// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test"
import {
  clearCollections,
  getAdminFirestore,
  signInWithEmailCode,
} from "./helpers"
import {
  ADMIN_EMAIL,
  BILL_OPEN_ID,
  BILL_OPEN_REFERENCE,
} from "./global-setup"

test.describe("Rechnungen workspace", () => {
  test.beforeEach(async () => {
    await clearCollections("loginCodes")
    // The mark-paid flow mutates the open bill — reset it.
    const db = getAdminFirestore()
    await db
      .collection("bills")
      .doc(BILL_OPEN_ID)
      .set({ paidAt: null, paidVia: null }, { merge: true })
  })

  test("invoice list shows statuses, filters and screenshot", async ({
    page,
  }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto("/invoices")

    const openRow = page.getByRole("row", { name: /RE-002041/ })
    await expect(openRow.getByText("offen", { exact: true })).toBeVisible()
    const overdueRow = page.getByRole("row", { name: /RE-002036/ })
    await expect(overdueRow.getByText("überfällig")).toBeVisible()
    const paidRow = page.getByRole("row", { name: /RE-002038/ })
    await expect(paidRow.getByText("bezahlt", { exact: true })).toBeVisible()

    // Status pill narrows the list.
    await page
      .getByRole("button", { name: "Überfällig", exact: true })
      .click()
    await expect(page.getByRole("row", { name: /RE-002036/ })).toBeVisible()
    await expect(
      page.getByRole("row", { name: /RE-002041/ }),
    ).not.toBeVisible()
    await page.getByRole("button", { name: "Alle", exact: true }).click()

    // The open bill's date cell is seeded relative to "now" — mask the
    // whole date column so the baseline stays stable.
    await expect(page).toHaveScreenshot("invoices-list.png", {
      fullPage: false,
      mask: [page.locator("tbody td:nth-child(4)")],
      maxDiffPixelRatio: 0.01,
    })
  })

  test("bulk mark-paid books the selected bills", async ({ page }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto("/invoices")

    // Tick the open bill's row checkbox → bulk bar appears.
    await page
      .getByRole("checkbox", { name: `RE-002041 auswählen` })
      .click()
    await expect(page.getByText(/1 ausgewählt/)).toBeVisible()
    await page
      .getByRole("button", { name: "Als bezahlt markieren" })
      .click()

    // Confirm in the dialog (default channel E-Banking).
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Als bezahlt markieren" })
      .click()
    await expect(page.getByText(/1 als bezahlt markiert/)).toBeVisible()

    // Firestore reflects the booking (via the admin callable).
    const db = getAdminFirestore()
    await expect
      .poll(async () => {
        const snap = await db.collection("bills").doc(BILL_OPEN_ID).get()
        return snap.data()?.paidVia ?? null
      })
      .toBe("ebanking")
  })

  test("bill detail shows facts and the visit link", async ({ page }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto(`/invoices/${BILL_OPEN_ID}`)

    await expect(
      page.getByRole("heading", { name: `RE-00${BILL_OPEN_REFERENCE}` }),
    ).toBeVisible()
    await expect(page.getByText("CHF 84.00")).toBeVisible()

    // Deep link into the billed visit.
    await page.getByRole("link", { name: /Besuch e2e-visi/ }).click()
    await page.waitForURL((url) => url.pathname.startsWith("/visits/"))
    await expect(page.getByText("Lasercutter Nutzung")).toBeVisible()
  })

  test("statement import matches a camt.053 payment to the open bill", async ({
    page,
  }) => {
    await signInWithEmailCode(page, ADMIN_EMAIL)
    await page.goto("/invoices/import")

    // Minimal camt.053 whose SCOR reference resolves to the open bill.
    // Check digits: mod-97 over "0000020411827150 0" → RF62 for payload
    // 000002041 is computed in the app; use the tolerant path by building
    // the reference the same way the functions do (9-digit payload).
    const reference = validScorFor(BILL_OPEN_REFERENCE)
    const camt = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt><Stmt>
    <Ntry>
      <Amt Ccy="CHF">84.00</Amt>
      <CdtDbtInd>CRDT</CdtDbtInd>
      <BookgDt><Dt>2026-07-02</Dt></BookgDt>
      <NtryDtls><TxDtls>
        <RltdPties><Dbtr><Nm>Anna Architektin</Nm></Dbtr></RltdPties>
        <RmtInf><Strd><CdtrRefInf><Ref>${reference}</Ref></CdtrRefInf></Strd></RmtInf>
      </TxDtls></NtryDtls>
    </Ntry>
    <Ntry>
      <Amt Ccy="CHF">25.00</Amt>
      <CdtDbtInd>CRDT</CdtDbtInd>
      <BookgDt><Dt>2026-07-02</Dt></BookgDt>
    </Ntry>
  </Stmt></BkToCstmrStmt>
</Document>`

    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: "statement.xml",
        mimeType: "application/xml",
        buffer: Buffer.from(camt),
      })

    // One matched, one unmatched. (No currency amounts in regex matchers:
    // formatCHF emits a non-breaking space, which regexes see raw.)
    await expect(page.getByText("2 Gutschriften erkannt")).toBeVisible()
    await expect(page.getByText(/1 zugeordnet ·/)).toBeVisible()
    await expect(page.getByText("— fehlt —")).toBeVisible()

    await page.getByRole("button", { name: "Zahlungen buchen" }).click()
    await expect(page.getByText("1 Zahlungen gebucht.")).toBeVisible()

    // Booked with the statement's value date.
    const db = getAdminFirestore()
    const snap = await db.collection("bills").doc(BILL_OPEN_ID).get()
    expect(snap.data()?.paidVia).toBe("ebanking")
    expect(snap.data()?.paidAt?.toDate().toISOString()).toContain("2026-07-02")
  })
})

/** ISO 11649 SCOR reference for a bill number (mirrors the functions impl). */
function validScorFor(referenceNumber: number): string {
  const payload = String(referenceNumber).padStart(9, "0")
  const rearranged = payload + "RF00"
  const numeric = rearranged.replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55),
  )
  let mod = 0
  for (const digit of numeric) mod = (mod * 10 + Number(digit)) % 97
  const check = String(98 - mod).padStart(2, "0")
  return `RF${check}${payload}`
}
