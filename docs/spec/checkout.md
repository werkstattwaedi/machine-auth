# Visit & checkout

Checking in, when a visit begins, the persons on it, usage types and the
usage fee, Check Out and Bezahlen — as it holds on any device; what differs
at the kiosk is in [kiosk.md](kiosk.md), the payment methods and documents
in [billing.md](billing.md). Terms: see the [glossary](README.md#glossary).

## Check-in

- **CHK-1** The check-in starts with a choice: sign in (ACC-1) or continue as a guest. — ADR-0031
- **CHK-6** An identified person's own details are filled in on the check-in; further persons are added there. — ADR-0031
- **CHK-2** A person who opens the app with an open checkout is taken past the check-in:

  | The open checkout is from | Lands on |
  |---|---|
  | today | Kosten |
  | an earlier day | Check Out |

- **CHK-3** A visit starts when the person continues past the check-in: its checkout is created then, with everyone on the check-in as its persons. — #246
- **CHK-7** Continuing past the check-in with an open checkout puts the persons on that checkout; no second checkout is created. — #246
- **CHK-9** An open checkout whose usage type is *Nur Materialbezug* is a purchase-only checkout (CHK-5), not a started visit. — #666, #732

## Persons on a visit

- **CHK-10** On the check-in, the identified person stays; any other person can be removed as long as someone stays. — ADR-0048, #747
- **CHK-11** When a checkout is closed, only the account holder's own line stays linked to their account; every other person is recorded by name alone. — #741, ADR-0048, #747

## Usage fee

- **CHK-12** A second visit of the same account on one day charges no usage fee again for its account holder if they were already charged it that day; every other person pays it on every visit. — #268, ADR-0048, #747

## Usage type

- **CHK-4** The person chooses the usage type on Check Out; it decides what the checkout bills — #284, #570:

  | Usage type | For | Usage fee | Machine time | Material | Offered to a guest |
  |---|---|---|---|---|---|
  | *Reguläre Nutzung* | everyone | full | full | full | yes |
  | *Ermässigte Nutzung (KulturLegi)* | KulturLegi holders | half | full | full | yes |
  | *Hangenmoos AG* | tenants of the Hangenmoos AG | none | full | full | yes |
  | *Nur Materialbezug* | buying material or picking up a print, without working in the workshop | none | not allowed (CHK-8) | full | yes |
  | *Freiwilligengruppe* | a workshop supervisor working on their own project | none | none | full | no |
  | *Interne Nutzung* | work on a project for the OWW itself | none | none | none | no |

- **CHK-8** A checkout can't be closed with these usage types and items together — #284:

  | Usage type | Items in the checkout |
  |---|---|
  | *Nur Materialbezug* | machine time; the option is shown greyed out with the reason (#628) |
  | *Interne Nutzung* | a paid badge (a membership: MEM-6) |

- **CHK-5** A membership or badge bought without a visit opens a purchase-only checkout, whose usage type is *Nur Materialbezug* and which carries no usage fee (CHK-4). — ADR-0030, #660

## Check Out

- **CHK-13** On Check Out the person can add a donation of any amount, which is added to the total. — #250
- **CHK-18** While the total, donation included, is not a whole franc, Check Out offers rounding it up to one of up to four suggested round amounts — none more than 10 % or CHF 5 above it, whichever is more, the smallest picked unless the person chooses another — and the difference is added to the donation (CHK-13). — #233, #250
- **CHK-19** On Check Out, below the total, the person chooses one of the offered payment methods (BIL-2, BIL-4); none is chosen for them, and there is no other way on. — #650, #750
- **CHK-20** A checkout totalling CHF 0 offers one action that completes it in place of the payment methods (BIL-8); a donation (CHK-13) that makes the total positive brings the methods back. — #750

## Bezahlen

- **CHK-21** Choosing a method opens Bezahlen for it, showing the amount to pay; until the commit (CHK-22) "Zurück" returns to Check Out with everything still editable and the donation and round-up kept. — #650, #750
- **CHK-22** One action closes the checkout, issues its bill (BIL-16) and commits the payment method (BIL-36); from then on nothing on the checkout can be changed and there is no way back — #650, #750:

  | Method | The action |
  |---|---|
  | QR-Rechnung | the button that sends the Rechnung |
  | Sammelrechnung | the button that puts the checkout on the Sammelrechnung |
  | TWINT | the button that opens the paylink — choosing TWINT alone commits nothing, and nothing confirms the payment afterwards (BIL-6) |
  | CHF 0 | its one action on Check Out (CHK-20) |

- **CHK-23** After the commit the person is told that the checkout is complete and, unless it is CHF 0 (BIL-8), to which e-mail address (BIL-25) its document goes — #750, #761:

  | Method | Told |
  |---|---|
  | QR-Rechnung | the Rechnung was sent |
  | Sammelrechnung | the date of the next monthly run (BIL-19) the Sammelrechnung comes on |
  | TWINT | the document was sent, and whom to contact if the TWINT payment did not go through (BIL-6) |

- **CHK-24** Only after a QR-Rechnung was confirmed can the person unfold the QR code of its QR slip, and never on a phone. — ADR-0020, #750
- **CHK-25** On an own device the PDF download (BIL-15) is offered once the method is committed, and waits for the PDF to be generated instead of failing. — #750
- **CHK-27** After TWINT is committed, Bezahlen offers to open the paylink again. — #750
- **CHK-26** After the commit, what the person can do next depends on where they are — ADR-0022, #750:

  | Where | Offered | Then |
  |---|---|---|
  | the kiosk | "Fertig", filling over 8 s and then pressing itself; once the QR code was unfolded (CHK-24), or while a TWINT payment is still in the overlay (KIO-20), it waits to be pressed instead | the kiosk resets (KIO-8) |
  | an own device, signed in | "Fertig", without countdown | the account's Nutzungsverlauf |
  | an own device, as a guest | no button; the person is told they can close the window | nothing — the guest is neither signed out nor sent anywhere |

## Open questions

- [NEEDS CLARIFICATION] A person who signs in on the check-in of their own device while a checkout of theirs is open stays on the check-in, its persons filled from that checkout, instead of landing on Kosten (CHK-2); the same sign-in at the kiosk lands on Kosten (KIO-1). Intended?
- [NEEDS CLARIFICATION] Only the app keeps a person to one open checkout (CHK-7); nothing on the server refuses a second one when two devices check in at once. Intended?
- [NEEDS CLARIFICATION] *Freiwilligengruppe* and *Interne Nutzung* are not offered to a guest (CHK-4), but only the app withholds them; the server accepts them from anyone. Should the server refuse them too? — #570
- [NEEDS CLARIFICATION] A person added by name who returns the same day pays the usage fee again (CHK-12): without an account link there is nothing to match them on. Intended, or should the same name on the same account count?
- [NEEDS CLARIFICATION] An identified person who only accompanies someone (a parent with a child) pays the usage fee too, since they stay on the check-in (CHK-10). A per-person accompaniment option is #605.
- [NEEDS CLARIFICATION] After the commit (CHK-22) a reload, the browser's back or a deep link leaves Bezahlen for good: there is no open checkout, the person is sent to the check-in, and a guest has no way back to the PDF download (CHK-25) or the paylink (CHK-27) — the document is in the mail (BIL-26). Intended?

## Retired

<!-- `- CHK-n — <PR that retired it>` -->
- CHK-14 — #761 (the close on "Weiter zum Bezahlen" before a method was chosen; confirming the method closes now, CHK-22)
- CHK-15 — #761 (picking and confirming on Bezahlen, the pick recorded for the overnight commit; the method is chosen on Check Out, CHK-19, and written only with the commit, CHK-22)
- CHK-16 — #761 (the QR code on screen on every device while the QR-Rechnung was picked; now unfolded on request after sending, CHK-24)
- CHK-17 — #761 (the completion dialog and its per-device follow-up; replaced by CHK-26)
