// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Client-side statement parsing + matching for the Rechnungen statement
 * import. Two upload formats resolve to the same shape:
 *
 *  - camt.053 XML (bank / QR-Rechnung) — payments arrive on the IBAN.
 *  - RaiseNow TWINT export (CSV) — the "Kreditor-Referenz" column carries
 *    the same reference.
 *
 * Our QR-bills carry SCOR references (ISO 11649, "RF.." — see
 * functions/src/invoice/scor_reference.ts), so an entry's creditor
 * reference resolves directly to a bill's `referenceNumber`.
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

/** Which channel the statement covers — determines the booked `paidVia`. */
export type StatementKind = "camt" | "twint"

/** Statement-level metadata + credit entries. */
export interface ParsedStatement {
  kind: StatementKind
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
    kind: "camt",
    entries,
    toDateMs: Number.isFinite(toDateMs) ? toDateMs : null,
  }
}

/**
 * Parse a RaiseNow TWINT export (CSV). Columns are matched by header
 * text, not position — RaiseNow adds/reorders columns between exports.
 * Only `succeeded` payments are returned; the "Kreditor-Referenz" column
 * carries our SCOR reference. "Abgeglichen bis" is the newest payment's
 * creation time (the export has no explicit period).
 */
export function parseRaiseNowCsv(csv: string): ParsedStatement {
  const rows = parseCsv(csv)
  if (rows.length < 2) {
    throw new Error("TWINT-Export enthält keine Zahlungen.")
  }
  const header = rows[0].map((h) => h.trim())
  const col = (name: string) => header.indexOf(name)
  const statusCol = col("Status")
  const referenceCol = col("Kreditor-Referenz")
  const amountCol = col("Betrag")
  if (statusCol < 0 || referenceCol < 0 || amountCol < 0) {
    throw new Error(
      "Datei ist kein RaiseNow-TWINT-Export (Spalten Status / Kreditor-Referenz / Betrag fehlen).",
    )
  }
  const createdCol = col("Erstellt")
  const firstNameCol = col("Vorname")
  const lastNameCol = col("Nachname")
  const nameCol = col("Name")

  const entries: StatementEntry[] = []
  let latestMs: number | null = null
  for (const row of rows.slice(1)) {
    if (row.every((cell) => cell.trim() === "")) continue
    if (row[statusCol]?.trim().toLowerCase() !== "succeeded") continue
    const amount = parseFloat(row[amountCol]?.replace(/'/g, "") ?? "")
    if (!Number.isFinite(amount)) continue
    const reference = row[referenceCol]?.replace(/\s+/g, "") || null
    const bookingDateMs = createdCol >= 0 ? parseRaiseNowDate(row[createdCol]) : null
    const debtorName =
      [row[firstNameCol], row[lastNameCol]]
        .filter((part) => part && part.trim())
        .join(" ")
        .trim() ||
      (nameCol >= 0 ? row[nameCol]?.trim() : "") ||
      null
    if (bookingDateMs != null && (latestMs == null || bookingDateMs > latestMs)) {
      latestMs = bookingDateMs
    }
    entries.push({
      amount,
      currency: "CHF",
      bookingDateMs,
      reference,
      debtorName,
    })
  }
  return { kind: "twint", entries, toDateMs: latestMs }
}

/** RaiseNow "Erstellt" format: `07/05/2026 10:14:26 PM` (MM/DD/YYYY, 12h). */
function parseRaiseNowDate(raw: string | undefined): number | null {
  if (!raw) return null
  const m = raw
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))? ?(AM|PM)?)?$/i)
  if (!m) return null
  const [, month, day, year, hour, minute, second, meridiem] = m
  let h = Number(hour ?? 0)
  if (meridiem?.toUpperCase() === "PM" && h < 12) h += 12
  if (meridiem?.toUpperCase() === "AM" && h === 12) h = 0
  const ms = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    h,
    Number(minute ?? 0),
    Number(second ?? 0),
  ).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** Minimal RFC-4180 CSV parser (quoted fields, embedded commas/newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      field = ""
      rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * Dispatch on file content: XML → camt.053, otherwise a RaiseNow TWINT
 * CSV. Throws a German message when neither format matches.
 */
export function parseStatementFile(text: string): ParsedStatement {
  if (text.trimStart().startsWith("<")) return parseCamt053(text)
  return parseRaiseNowCsv(text)
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
