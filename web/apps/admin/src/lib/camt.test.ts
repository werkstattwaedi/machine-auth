// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import {
  matchStatement,
  parseCamt053,
  parseRaiseNowCsv,
  parseStatementFile,
  referenceNumberFromScor,
  type MatchableBill,
} from "./camt"

// Minimal camt.053 with the paths our parser reads. Namespaced like real
// exports; RF29000100042 is the repo's known-good SCOR test vector.
const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <Stmt>
      <FrToDt><FrDtTm>2026-06-01T00:00:00</FrDtTm><ToDtTm>2026-06-30T23:59:59</ToDtTm></FrToDt>
      <Ntry>
        <Amt Ccy="CHF">84.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-06-28</Dt></BookgDt>
        <NtryDtls><TxDtls>
          <Amt Ccy="CHF">84.00</Amt>
          <RltdPties><Dbtr><Nm>Mike Schneider</Nm></Dbtr></RltdPties>
          <RmtInf><Strd><CdtrRefInf><Ref>RF29 0001 0004 2</Ref></CdtrRefInf></Strd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">25.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-06-29</Dt></BookgDt>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">12.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`

describe("parseCamt053", () => {
  it("extracts credit entries with reference, debtor and booking date", () => {
    const { entries, toDateMs } = parseCamt053(CAMT)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      amount: 84,
      currency: "CHF",
      reference: "RF29000100042",
      debtorName: "Mike Schneider",
    })
    expect(entries[0].bookingDateMs).toBe(Date.parse("2026-06-28"))
    // Reference-less credit stays for manual matching; debits are dropped.
    expect(entries[1].reference).toBeNull()
    expect(toDateMs).toBe(Date.parse("2026-06-30T23:59:59"))
  })

  it("throws on non-XML input", () => {
    expect(() => parseCamt053("definitely,csv,content")).toThrow(/camt\.053/)
  })
})

// RaiseNow TWINT export as documented by the real download (issue: TWINT
// reconciliation). Row 2 is pending, row 3 has a quoted name with comma.
const RAISENOW_CSV = [
  "Status,Identifikationsnummer,Erstellt,Betrag,Touchpoint-Name,Kreditor-Referenz,Name,Vorname,Nachname,E-Mail-Adresse",
  "succeeded,19132375-a397-4267-a2ef-04f30e13f96b,07/05/2026 10:14:26 PM,0.50,Self Checkout,RF29 0001 0004 2,,Mike,Schneider,michschn@gmail.com",
  "pending,5c1f0000-0000-0000-0000-000000000000,07/05/2026 10:20:00 PM,12.00,Self Checkout,RF18539007547034,,Anna,Lehmann,anna@example.ch",
  'succeeded,7a2b0000-0000-0000-0000-000000000000,07/02/2026 09:00:00 AM,25.00,Self Checkout,,"Keller, Rolf",,,rolf@example.ch',
].join("\r\n")

describe("parseRaiseNowCsv", () => {
  it("extracts succeeded payments with reference, name and created date", () => {
    const { kind, entries, toDateMs } = parseRaiseNowCsv(RAISENOW_CSV)
    expect(kind).toBe("twint")
    // The pending row is dropped; the reference-less one stays for
    // manual matching.
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      amount: 0.5,
      currency: "CHF",
      reference: "RF29000100042",
      debtorName: "Mike Schneider",
    })
    expect(entries[0].bookingDateMs).toBe(
      new Date(2026, 6, 5, 22, 14, 26).getTime(),
    )
    // Quoted "Name" column is the fallback when Vorname/Nachname are empty.
    expect(entries[1].reference).toBeNull()
    expect(entries[1].debtorName).toBe("Keller, Rolf")
    // "Abgeglichen bis" = newest succeeded payment.
    expect(toDateMs).toBe(entries[0].bookingDateMs)
  })

  it("matches columns by header, not position", () => {
    const reordered = [
      "Betrag,Kreditor-Referenz,Status",
      "84.00,RF29000100042,succeeded",
    ].join("\n")
    const { entries } = parseRaiseNowCsv(reordered)
    expect(entries).toHaveLength(1)
    expect(entries[0].amount).toBe(84)
    expect(entries[0].reference).toBe("RF29000100042")
  })

  it("rejects CSVs without the expected columns", () => {
    expect(() => parseRaiseNowCsv("foo,bar\n1,2")).toThrow(/RaiseNow/)
    expect(() => parseRaiseNowCsv("")).toThrow(/keine Zahlungen/)
  })
})

describe("parseStatementFile", () => {
  it("dispatches XML to camt and CSV to the RaiseNow parser", () => {
    expect(parseStatementFile(CAMT).kind).toBe("camt")
    expect(parseStatementFile(RAISENOW_CSV).kind).toBe("twint")
  })
})

describe("referenceNumberFromScor", () => {
  it("parses the repo's known SCOR vectors", () => {
    expect(referenceNumberFromScor("RF29000100042")).toBe(100042)
    expect(referenceNumberFromScor("RF18539007547034")).toBe(539007547034)
  })

  it("tolerates spacing and lowercase", () => {
    expect(referenceNumberFromScor("rf29 0001 0004 2")).toBe(100042)
  })

  it("rejects checksum failures and non-SCOR refs", () => {
    expect(referenceNumberFromScor("RF32000100042")).toBeNull()
    expect(referenceNumberFromScor("210000000003139471430009017")).toBeNull()
    expect(referenceNumberFromScor("")).toBeNull()
  })
})

describe("matchStatement", () => {
  const bills: MatchableBill[] = [
    { id: "b1", referenceNumber: 100042, amount: 84, paid: false },
    { id: "b2", referenceNumber: 7, amount: 60, paid: true },
  ]

  it("splits matched / already-paid / unmatched", () => {
    const { entries } = parseCamt053(CAMT)
    const result = matchStatement(entries, bills)
    expect(result.matched).toHaveLength(1)
    expect(result.matched[0].bill.id).toBe("b1")
    expect(result.matched[0].amountMismatch).toBe(false)
    expect(result.alreadyPaid).toHaveLength(0)
    expect(result.unmatched).toHaveLength(1)
  })

  it("flags amount mismatches and already-paid bills", () => {
    const result = matchStatement(
      [
        {
          amount: 50,
          currency: "CHF",
          bookingDateMs: null,
          reference: "RF29000100042",
          debtorName: null,
        },
        {
          amount: 60,
          currency: "CHF",
          bookingDateMs: null,
          reference: scorFor7,
          debtorName: null,
        },
      ],
      bills,
    )
    expect(result.matched[0].amountMismatch).toBe(true)
    expect(result.alreadyPaid).toHaveLength(1)
    expect(result.alreadyPaid[0].bill.id).toBe("b2")
  })
})

// Valid SCOR ref for payload "000000007" (functions pad to 9 digits).
const scorFor7 = (() => {
  for (let check = 2; check <= 98; check++) {
    const candidate = `RF${String(check).padStart(2, "0")}000000007`
    if (referenceNumberFromScor(candidate) === 7) return candidate
  }
  throw new Error("unreachable")
})()
