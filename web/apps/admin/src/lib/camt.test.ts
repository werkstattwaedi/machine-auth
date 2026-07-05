// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import {
  matchStatement,
  parseCamt053,
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
