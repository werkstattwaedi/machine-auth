# Billing

Payment methods, the documents a person receives, bill numbers, the monthly
Sammelrechnung, corrections and booking payments. Terms: see the
[glossary](README.md#glossary).

## Payment methods

- **BIL-1** A checkout is paid by QR-Rechnung, Sammelrechnung or TWINT. — ADR-0044

  | Method | Paid during checkout (BIL-6) | Collected monthly | Members only | Document |
  |---|---|---|---|---|
  | QR-Rechnung | no | no | no | Rechnung with QR slip |
  | Sammelrechnung | no | yes | yes | Beleg, later a Sammelrechnung |
  | TWINT | yes | no | no | Quittung, no QR slip |

- **BIL-2** The kiosk and the own device each offer the methods configured for that client type, in the configured order. — ADR-0044
- **BIL-3** When the configured methods can't be read, or none is left after eligibility, only the QR-Rechnung is offered. — ADR-0044
- **BIL-4** Only an account holder with an active membership can pay by Sammelrechnung, a member identified by a badge tap included; anyone else — a visitor, the person buying their membership in that same checkout (MEM-7), a guest — is neither offered it nor accepted when asking for it. — ADR-0044, #414, #437, #750
- **BIL-6** Confirming TWINT is the person's own statement; the bill counts as paid only once the RaiseNow export is booked. — ADR-0020
- **BIL-7** A bill still unconfirmed an hour after it was issued — a renewal bill (MEM-24), or a checkout an older app version closed without a method — is committed overnight: as a Beleg when its checkout names the Sammelrechnung, otherwise as a QR-Rechnung. — #251, #302, #761
- **BIL-36** Confirming a payment method commits the bill at once and can't be undone; a bill nobody confirms is committed overnight (BIL-7). — #251, #302
- **BIL-8** A checkout totalling CHF 0 asks for no payment method and sends no bill mail, unless it corrects an earlier bill (BIL-28). — #237

## Documents

- **BIL-9** Every document's title and file name name its kind: Rechnung, Quittung, Beleg or Sammelrechnung. — #405, #426
- **BIL-10** Only a Rechnung or Sammelrechnung with an amount due carries a QR slip; a Beleg says its amount is added to the next Sammelrechnung. — ADR-0044
- **BIL-11** A Quittung names the payment method but never states that the payment was received.
- **BIL-12** On a document, line items are grouped by workshop with a subtotal each, a membership is listed first, and a donation is listed as such. — #262, #464
- **BIL-13** The QR slip is a separate last page, not counted in the document's page numbers. — #464
- **BIL-14** A document is addressed to the company for a company account, else the account holder, else the name given at check-in, and shows the postal address only when it is complete. — #269, #658
- **BIL-35** A checkout produces one bill, to its account holder; the other persons on the visit are lines on that bill (CHK-11) and are never billed themselves. — ADR-0048, #747
- **BIL-15** The person can download a document's PDF on their own device, not at the kiosk; a guest only in the browser session that closed the checkout, and only from Bezahlen after the commit (CHK-25). — #418, #750

## Numbering & references

- **BIL-16** A bill gets its number when it is issued — at checkout close, by the monthly run (BIL-19) or by the renewal invoicer (MEM-24); a Rechnung, Quittung or Sammelrechnung shows it as `RE-<number>` and a Beleg as `BL-<number>`. — ADR-0042
- **BIL-17** A correction keeps the original number with a revision suffix (`RE-4200001-1` … `-9`), and its QR reference ends in that digit; a tenth correction is refused. — ADR-0042

## Monthly Sammelrechnung

- **BIL-19** On the first run of a month, each account holder's Belege from earlier months become one Sammelrechnung; a missed run catches up on the next day. — #245
- **BIL-20** A Sammelrechnung totals its Belege, leaves cancelled ones out, is sent without the member confirming again, and is issued even if the membership has ended.

## Cancellation & correction

- **BIL-21** Only an admin can cancel or correct a closed checkout, and never a paid bill, a Beleg whose Sammelrechnung is paid, a membership renewal, or a checkout containing a membership or badge. — ADR-0042
- **BIL-22** A cancelled checkout and its bill stay visible as cancelled with their original PDF; a correction is a new checkout whose document names the one it replaces, the date and the reason. — ADR-0042
- **BIL-23** Correcting a Beleg that is part of a Sammelrechnung re-issues the whole Sammelrechnung as one revision, or cancels it when no Beleg is left. — ADR-0042
- **BIL-24** A cancelled bill can no longer be confirmed, committed overnight, collected into a Sammelrechnung or booked as paid. — ADR-0042

## Mail

- **BIL-25** Bill mail goes only to the account holder, or for a guest without an account to the first e-mail given at check-in, and to nobody else on the visit. — ADR-0048, #471, #651
- **BIL-37** A bill whose recipient (BIL-25) has no e-mail address is not mailed; the person is told so on Bezahlen (CHK-23). — #651, #761
- **BIL-26** A Rechnung or Quittung is mailed once the payment method is committed, a Beleg when the checkout becomes a Beleg, and a Sammelrechnung by the monthly run. — #251, #405
- **BIL-27** A Beleg and a Sammelrechnung are announced by different mails. — ADR-0046, #502
- **BIL-28** A correction sends exactly one mail for the new top-level document, with corrected Belege attached; a cancellation without replacement sends a notice only if the original was mailed. — ADR-0042

## Payment booking

- **BIL-29** Only an admin books payments, by hand or by importing a bank (camt.053) or RaiseNow statement; booking skips bills already paid.
- **BIL-30** A statement import matches payments by QR reference and lists unmatched, duplicate and cancelled-bill payments for manual handling; a payment with a different amount is booked with a warning.
- **BIL-31** Booking a payment sends no mail and changes no document.
- **BIL-34** Nothing waits for payment: a committed bill grants what it bills (visit, badge, membership, renewal) at once, and whether it was paid is only established when payments are booked; unpaid bills are followed up at reconciliation. — #746

## Retention

- **BIL-32** Bills are kept 3 years after payment (unpaid ones: after creation) and their PDFs 10 years in a locked archive; a renewal bill that is not yet committed (MEM-35) is never deleted. — ADR-0038
- **BIL-33** A person's data can't be erased while they have an unpaid bill. — ADR-0038

## Open questions

- [NEEDS CLARIFICATION] A single-visit Sammelrechnung is titled "Rechnung" on the PDF but sent with the Sammelrechnung mail. Which name is intended?
- [NEEDS CLARIFICATION] A partial payment (amount mismatch) is booked as fully paid (BIL-30). Intended?
- [NEEDS CLARIFICATION] Correction mails for TWINT bills promise a refund or settlement of the difference, but there is no refund flow (ADR-0042 backlog). A rule, or a known gap?

## Retired

<!-- `- BIL-n — <PR that retired it>` -->
- BIL-18 — #743 (bill-number migration; a one-off transition, not the product)
- BIL-5 — #761 (the TWINT confirm button gated behind the paylink; the click that opens the paylink is the confirmation now, CHK-22)
