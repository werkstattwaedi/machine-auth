# Billing

Payment methods, the documents a person receives, bill numbers, the monthly
Sammelrechnung, corrections and booking payments. Terms: see the
[glossary](README.md#glossary).

## Payment methods

- **BIL-1** A checkout is paid by QR-Rechnung, Sammelrechnung, RaiseNow or at the Wallee terminal. — ADR-0044, ADR-0051, #735

  | Method | Paid during checkout (BIL-6) | Collected monthly | Members only | Document |
  |---|---|---|---|---|
  | QR-Rechnung | no | no | no | Rechnung with QR slip |
  | Sammelrechnung | no | yes | yes | Beleg, later a Sammelrechnung |
  | RaiseNow | yes | no | no | Quittung, no QR slip |
  | Wallee terminal | yes, a verified payment (BIL-39) | no | no | Quittung, no QR slip |

- **BIL-2** The kiosk and the own device each offer the methods configured for that client type, in the configured order — the Wallee terminal only at a kiosk set up to drive it. — ADR-0044, ADR-0051, #735
- **BIL-3** When the configured methods can't be read, or none is left after eligibility, only the QR-Rechnung is offered. — ADR-0044
- **BIL-4** Only an account holder with an active membership can pay by Sammelrechnung, a member identified by a badge tap included; anyone else — a visitor, the person buying their membership in that same checkout (MEM-7), a guest — is neither offered it nor accepted when asking for it. — ADR-0044, #414, #437, #750
- **BIL-6** Confirming RaiseNow is the person's own statement; the bill counts as paid only once the RaiseNow export is booked. — ADR-0020
- **BIL-7** A bill still unconfirmed an hour after it was issued — a renewal bill (MEM-24), or a checkout an older app version closed without a method — is committed overnight: as a Beleg when its checkout names the Sammelrechnung and its account holder is an active member (BIL-4), otherwise as a QR-Rechnung. — #251, #302, #761, #745
- **BIL-36** Confirming a payment method commits the bill at once and can't be undone; a bill issued without a committed method that nobody confirms is committed overnight (BIL-7). — #251, #302
- **BIL-39** A checkout paid by a verified payment stays open until the payment provider confirms the payment to the server — for the Wallee terminal right after the payment, or the next night if that notice is lost — and never on the kiosk's or the person's word; only then is it closed, its bill issued (BIL-16) already paid and the method committed, and a declined or abandoned payment leaves it open without a bill. — ADR-0051, #735
- **BIL-40** A verified payment (BIL-39) closes the checkout with exactly the persons and their usage types, the items, the donation and the amount priced when that payment was started, and its bill is paid as of the time the provider authorised the payment. — ADR-0051, #735, #788
- **BIL-42** A change made to the checkout after a verified payment was started for it doesn't hold the payment up: the provider's confirmation still closes the checkout as priced then (BIL-40), and the team is alerted to the difference — ADR-0051, #788:

  | Changed after the start | On the closed checkout |
  |---|---|
  | an item added or removed, or a quantity changed | the items and quantities as priced |
  | a person added or removed, or a usage type changed (CHK-4, CHK-40) | the persons and usage types as priced |
  | machine time arrived from a machine terminal (CHK-44), on an existing or a new machine row | the machine rows and their minutes as priced, leaving out the sessions that arrived later (CHK-44), which are billed neither there nor on a later checkout |

- **BIL-43** A checkout takes at most ten payments started at the Wallee terminal, each start counting whether or not the terminal took it; an eleventh is refused, and the person is told to contact the team. — ADR-0051, #735
- **BIL-8** A checkout totalling CHF 0 asks for no payment method and sends no bill mail, unless it corrects an earlier bill (BIL-28). — #237

## Documents

- **BIL-9** Every document's title and file name name its kind: Rechnung, Quittung, Beleg or Sammelrechnung. — #405, #426
- **BIL-10** Only a Rechnung or Sammelrechnung with an amount due carries a QR slip; a Beleg says its amount is added to the next Sammelrechnung. — ADR-0044
- **BIL-11** A Quittung names the payment method; it states that the payment was received only for a verified payment (BIL-39), and then also gives the payment date and, for the Wallee terminal, Wallee's cardholder receipt. — ADR-0051, #735
- **BIL-12** On a document, line items are grouped by workshop with a subtotal each, a membership is listed first, and a donation is listed as such. — #262, #464
- **BIL-38** A document lists every person on the checkout with their user type, their usage type unless regular — *Nur Materialbezug* on a purchase-only checkout (CHK-9) — and the usage fee they pay, then one row per waived machine or material section naming the visit's type (CHK-29); a person whose usage fee is waived for an earlier visit that day (CHK-37) is listed at CHF 0 with the reason. — #284, #268, #269, ADR-0050, #605
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

- **BIL-29** Only an admin books payments, by hand or by importing a bank (camt.053) or RaiseNow statement — except a verified payment, booked as its bill is issued (BIL-39); booking skips bills already paid. — ADR-0051, #735
- **BIL-30** A statement import matches payments by QR reference and lists unmatched, duplicate and cancelled-bill payments for manual handling; a payment with a different amount is booked with a warning.
- **BIL-31** Booking a payment sends no mail and changes no document.
- **BIL-34** Nothing but a verified payment (BIL-39) waits for payment: a committed bill grants what it bills (visit, badge, membership, renewal) at once, and whether it was paid is only established when payments are booked; unpaid bills are followed up at reconciliation. — #746, ADR-0051
- **BIL-41** In these cases a payment at the Wallee terminal changes no checkout or bill, and the money is handled by hand — ADR-0051, #735:

  | Case | What stays |
  |---|---|
  | it arrives for a checkout already closed — by an earlier payment at the Wallee terminal or another method — or cancelled | the checkout and its bill as they are |
  | its amount differs from the one priced when it was started (BIL-40) | the checkout stays open |
  | it is reversed after it closed the checkout | the checkout stays closed and its bill paid |

## Retention

- **BIL-32** Bills are kept 3 years after payment (unpaid ones: after creation) and their PDFs 10 years in a locked archive; a renewal bill that is not yet committed (MEM-35) is never deleted. — ADR-0038
- **BIL-33** A person's data can't be erased while they have an unpaid bill. — ADR-0038

## Open questions

- [NEEDS CLARIFICATION] A single-visit Sammelrechnung is titled "Rechnung" on the PDF but sent with the Sammelrechnung mail. Which name is intended?
- [NEEDS CLARIFICATION] A partial payment (amount mismatch) is booked as fully paid (BIL-30). Intended?
- [NEEDS CLARIFICATION] Correction mails for RaiseNow bills promise a refund or settlement of the difference, but there is no refund flow (ADR-0042 backlog). A rule, or a known gap?

## Retired

<!-- `- BIL-n — <PR that retired it>` -->
- BIL-18 — #743 (bill-number migration; a one-off transition, not the product)
- BIL-5 — #761 (the RaiseNow confirm button gated behind the paylink; the click that opens the paylink is the confirmation now, CHK-22)
