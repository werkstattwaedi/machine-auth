// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Client-side camt.053 (bank statement) parsing + matching for the
 * Rechnungen statement import. Our QR-bills carry SCOR references
 * (ISO 11649, "RF.." — see functions/src/invoice/scor_reference.ts), so a
 * credit entry's creditor reference resolves directly to a bill's
 * `referenceNumber`.
 */

export interface StatementEntry {
  /** Credit amount in the statement currency. */
  amount: number
  currency: string
  /** Booking date (value date) as epoch ms, when present. */
  bookingDateMs: number | null
  /** Raw creditor reference (SCOR/QRR), whitespace-stripped. */
  reference: string | null
  /** Debtor name — helps manual matching of unmatched payments. */
  debtorName: string | null
}

/** Statement-level metadata + credit entries. */
export interface ParsedStatement {
  entries: StatementEntry[]
  /** Statement period end ("abgeglichen bis"), when present. */
  toDateMs: number | null
}

/**
 * Parse a camt.053 XML document. Only CRDT (incoming) entries are
 * returned — debits can't pay our invoices. Throws on non-XML input.
 */
export function parseCamt053(xml: string): ParsedStatement {
  const doc = new DOMParser().parseFromString(xml, "application/xml")
  if (doc.querySelector("parsererror")) {
    throw new Error("Datei ist kein gültiges camt.053-XML.")
  }
  // Tag names are namespaced (urn:iso:std:iso:20022...); match on local
  // name so any camt.053 flavor parses.
  const byLocal = (root: Element | Document, name: string): Element[] =>
    Array.from(root.getElementsByTagNameNS("*", name))

  const entries: StatementEntry[] = []
  for (const ntry of byLocal(doc, "Ntry")) {
    const cdtDbt = byLocal(ntry, "CdtDbtInd")[0]?.textContent?.trim()
    if (cdtDbt !== "CRDT") continue
    const amtEl = byLocal(ntry, "Amt")[0]
    const amount = parseFloat(amtEl?.textContent ?? "")
    if (!Number.isFinite(amount)) continue
    const currency = amtEl?.getAttribute("Ccy") ?? "CHF"
    const bookgDt = byLocal(ntry, "BookgDt")[0]
    const dateText = bookgDt
      ? byLocal(bookgDt, "Dt")[0]?.textContent?.trim() ??
        byLocal(bookgDt, "DtTm")[0]?.textContent?.trim()
      : undefined
    const bookingDateMs = dateText ? Date.parse(dateText) : NaN

    // A statement entry may batch several transactions; emit one entry
    // per TxDtls when present so each payment matches its own bill.
    const txDetails = byLocal(ntry, "TxDtls")
    const scopes = txDetails.length > 0 ? txDetails : [ntry]
    for (const scope of scopes) {
      const ref =
        byLocal(scope, "CdtrRefInf")[0] &&
        byLocal(byLocal(scope, "CdtrRefInf")[0], "Ref")[0]?.textContent
      const txAmtEl =
        txDetails.length > 0 ? byLocal(scope, "Amt")[0] ?? amtEl : amtEl
      const txAmount = parseFloat(txAmtEl?.textContent ?? "")
      const dbtr = byLocal(scope, "Dbtr")[0]
      const debtorName = dbtr
        ? (byLocal(dbtr, "Nm")[0]?.textContent?.trim() ?? null)
        : null
      entries.push({
        amount: Number.isFinite(txAmount) ? txAmount : amount,
        currency,
        bookingDateMs: Number.isFinite(bookingDateMs) ? bookingDateMs : null,
        reference: ref ? ref.replace(/\s+/g, "") : null,
        debtorName,
      })
    }
  }

  const toDt = byLocal(doc, "FrToDt")[0]
  const toText = toDt ? byLocal(toDt, "ToDtTm")[0]?.textContent?.trim() : undefined
  const toDateMs = toText ? Date.parse(toText) : NaN

  return {
    entries,
    toDateMs: Number.isFinite(toDateMs) ? toDateMs : null,
  }
}

/**
 * Resolve a SCOR creditor reference to our sequential bill
 * `referenceNumber`. Returns null for non-SCOR or checksum-invalid refs
 * (e.g. QRR references from unrelated payments).
 */
export function referenceNumberFromScor(reference: string): number | null {
  const ref = reference.replace(/\s+/g, "").toUpperCase()
  if (!/^RF\d{2}\d{1,21}$/.test(ref)) return null
  // ISO 11649 checksum: move "RFxx" to the end, letters → numbers
  // (A=10 … Z=35), then mod 97 must equal 1.
  const rearranged = ref.slice(4) + ref.slice(0, 4)
  const numeric = rearranged.replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55),
  )
  let mod = 0
  for (const digit of numeric) {
    mod = (mod * 10 + Number(digit)) % 97
  }
  if (mod !== 1) return null
  const payload = ref.slice(4)
  const n = parseInt(payload, 10)
  return Number.isFinite(n) ? n : null
}

export interface MatchableBill {
  id: string
  referenceNumber: number
  amount: number
  paid: boolean
}

export interface StatementMatch {
  entry: StatementEntry
  bill: MatchableBill
  /** Statement amount differs from the bill amount (partial payment etc.). */
  amountMismatch: boolean
}

export interface MatchResult {
  /** Payments matched to a currently unpaid invoice — bookable. */
  matched: StatementMatch[]
  /** Payments whose bill is already marked paid (re-imported statement). */
  alreadyPaid: StatementMatch[]
  /** Payments with no usable/known reference — left for manual handling. */
  unmatched: StatementEntry[]
}

export function matchStatement(
  entries: StatementEntry[],
  bills: MatchableBill[],
): MatchResult {
  const byReference = new Map(bills.map((b) => [b.referenceNumber, b]))
  const result: MatchResult = { matched: [], alreadyPaid: [], unmatched: [] }
  for (const entry of entries) {
    const refNumber = entry.reference
      ? referenceNumberFromScor(entry.reference)
      : null
    const bill = refNumber != null ? byReference.get(refNumber) : undefined
    if (!bill) {
      result.unmatched.push(entry)
      continue
    }
    const match: StatementMatch = {
      entry,
      bill,
      amountMismatch: Math.abs(entry.amount - bill.amount) > 0.005,
    }
    if (bill.paid) result.alreadyPaid.push(match)
    else result.matched.push(match)
  }
  return result
}
