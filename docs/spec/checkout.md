# Visit & checkout

Checking in, when a visit begins, the persons on it, usage types and the
usage fee, Check Out and Bezahlen — as it holds on any device; what differs
at the kiosk is in [kiosk.md](kiosk.md), the payment methods and documents
in [billing.md](billing.md). Terms: see the [glossary](README.md#glossary).

## Check-in

- **CHK-1** The check-in starts with a choice: sign in (ACC-1) or continue as a guest. — ADR-0031
- **CHK-6** An identified person's own details are filled in on the check-in; further persons are added there. — ADR-0031
- **CHK-28** A further person on the check-in is entered as an adult or a child, which sets their standard usage fee; only the first person of a guest check-in can be a company, which also gives its billing address (BIL-14). — ADR-0050, #605
- **CHK-2** A person who opens the app with an open checkout is taken past the check-in:

  | The open checkout is from | Lands on |
  |---|---|
  | today | Kosten |
  | an earlier day | Check Out |

- **CHK-3** When the person continues past the check-in, the checkout is created, with everyone on the check-in as its persons — a visit, unless it is a purchase-only checkout (CHK-9). — #246, ADR-0050, #605
- **CHK-7** Continuing past the check-in with an open checkout puts the persons on that checkout; no second checkout is created. — #246
- **CHK-9** A checkout with at least one person, all of them on *Begleitung / nur Materialbezug*, is a purchase-only checkout — nobody on it works in the workshop; every other checkout is a visit. — #666, #732, ADR-0050, #605

## Persons on a visit

- **CHK-10** On the check-in, the identified person stays; any other person can be removed as long as someone stays. — ADR-0048, #747
- **CHK-11** When a checkout is closed, only the account holder's own line stays linked to their account; every other person is recorded by name and user type. — #741, ADR-0048, ADR-0050, #605

## Saved persons

- **CHK-33** An identified person — signed in or by badge — can save a further person they typed in, with name and user type but not the usage type, by ticking it before continuing; the same name and type is never saved twice. — ADR-0050, #605
- **CHK-34** On the check-in, the identified person's saved persons who aren't on it yet are offered under "Person hinzufügen"; adding one fills in their name and type. — ADR-0050, #605
- **CHK-35** A saved person can be removed from that list after a confirmation; earlier visits are unaffected. — ADR-0050, #605
- **CHK-36** Saved persons belong to the account that saved them, whatever its membership, and are deleted with the account. — ADR-0050, #605

## Usage fee

- **CHK-37** A person whose usage type carries a usage fee (CHK-4) pays none of it on a visit when they were already on another visit of the same account — opened on the same day, closed before this one and not cancelled — on a usage type whose fee is at least as high; otherwise they pay it in full, and on a guest's checkout nobody gets this. — #268, ADR-0050, #605, #759
- **CHK-38** For CHK-37 the account holder is the same person by their account, and every other person — typed in or added from the saved persons (CHK-34) — by user type and name, the name compared ignoring case, extra spaces and word order. — ADR-0050, #605
- **CHK-39** The waiver (CHK-37) is applied wherever a usage fee is billed — closing a checkout, and an admin correction as of the visit it replaces — and Check Out shows the waived fee before the person pays. — ADR-0050, #605

## Usage type

- **CHK-4** Each person on the check-in has their own usage type, chosen there; it decides that person's usage fee, while the visit's type (CHK-29) decides machine time and material — #284, #570, ADR-0050, #605:

  | Usage type | For | Usage fee | Machine time, as the visit's type | Material, as the visit's type | Who can choose it |
  |---|---|---|---|---|---|
  | *Reguläre Nutzung* | everyone working in the workshop | full | full | full | everyone |
  | *Ermässigte Nutzung (KulturLegi)* | KulturLegi holders | half | full | full | everyone |
  | *Hangenmoos AG* | tenants of the Hangenmoos AG | none | full | full | everyone |
  | *Begleitung / nur Materialbezug* | someone who only accompanies, or buys material or picks up a print without working in the workshop | none | not allowed (CHK-8) | full | everyone |
  | *Freiwilligengruppe* | a workshop supervisor working on their own project | none | none | full | the identified person, alone (CHK-32) |
  | *Interne Nutzung* | work on a project for the OWW itself | none | none | none | the identified person, alone (CHK-32) |

- **CHK-29** A visit's type is derived from its persons — the identified person's *Freiwilligengruppe* or *Interne Nutzung*; otherwise *Begleitung / nur Materialbezug* when every person has it; otherwise *Reguläre Nutzung* — and decides machine time and material (CHK-4), while each person's usage fee follows their own type. — ADR-0050, #605
- **CHK-32** *Freiwilligengruppe* and *Interne Nutzung* can be chosen only by the identified person and only while nobody else is on the check-in; while one is chosen no further person can be added, and the server refuses them on any other line, next to other persons, or without an identified person. — ADR-0050, #605
- **CHK-30** On Check Out, each person with a discounted usage type gets one sentence saying what the person closing the checkout confirms about them. — #570, ADR-0050, #605
- **CHK-31** The Nutzungsgebühren section on Check Out lists each person with their user type, usage type and fee, with nothing to change there, and starts open when any person has a discounted usage type, otherwise closed. — #570, ADR-0050, #605
- **CHK-8** A checkout can't be closed with these visit types (CHK-29) and items together — #284, ADR-0050, #605:

  | Visit's type | Items in the checkout |
  |---|---|
  | *Begleitung / nur Materialbezug* (every person has it) | machine time; Check Out says so in the Maschinen section and does not continue to payment — the type is changed on the check-in |
  | *Interne Nutzung* | a paid badge (a membership: MEM-6) |

- **CHK-40** When machine time from a machine terminal reaches an open checkout whose account holder is on *Begleitung / nur Materialbezug*, the account holder's usage type becomes *Reguläre Nutzung* and the visit's type follows (CHK-29); every other person keeps theirs. — ADR-0050, #605
- **CHK-5** A membership or badge bought without a visit opens a checkout with the buyer as its only person, on *Begleitung / nur Materialbezug* — a purchase-only checkout (CHK-9) that carries no usage fee (CHK-4). — ADR-0030, #660, ADR-0050, #605

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

- **CHK-23** After the commit the person is told that the checkout is complete and, unless it is CHF 0 (BIL-8), what became of its document — #750, #761:

  | Case | Told |
  |---|---|
  | QR-Rechnung | the Rechnung was sent, and to which e-mail address (BIL-25) |
  | Sammelrechnung | the date of the next monthly run (BIL-19) the Sammelrechnung comes on, and to which e-mail address |
  | TWINT | the document was sent and to which e-mail address, and whom to contact if the TWINT payment did not go through (BIL-6) |
  | no e-mail address on record, any method | nothing was sent (BIL-37), and whom to contact |

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
- [NEEDS CLARIFICATION] After the commit (CHK-22) a reload, the browser's back or a deep link leaves Bezahlen for good: there is no open checkout, the person is sent to the check-in, and a guest has no way back to the PDF download (CHK-25) or the paylink (CHK-27) — the document is in the mail (BIL-26). Intended?
- [NEEDS CLARIFICATION] Nothing tells a person that machine time switched them to *Reguläre Nutzung* (CHK-40); their usage fee simply appears on Kosten and Check Out. Intended, or should Check Out say so? — #605

## Retired

<!-- `- CHK-n — <PR that retired it>` -->
- CHK-14 — #761 (the close on "Weiter zum Bezahlen" before a method was chosen; confirming the method closes now, CHK-22)
- CHK-15 — #761 (picking and confirming on Bezahlen, the pick recorded for the overnight commit; the method is chosen on Check Out, CHK-19, and written only with the commit, CHK-22)
- CHK-16 — #761 (the QR code on screen on every device while the QR-Rechnung was picked; now unfolded on request after sending, CHK-24)
- CHK-17 — #761 (the completion dialog and its per-device follow-up; replaced by CHK-26)
- CHK-12 — #759 (the same-day waiver now matches every person by name and waives what an earlier visit that day already charged: CHK-37..39)
