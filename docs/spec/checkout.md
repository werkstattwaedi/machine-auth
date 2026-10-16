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
- **CHK-14** "Weiter zum Bezahlen" on Check Out closes the checkout and issues its bill (BIL-16) before any payment method is chosen; from then on nothing on the checkout can be changed and there is no way back from Bezahlen.

## Bezahlen

- **CHK-15** On Bezahlen the person picks one of the offered methods (BIL-2) and confirms it with one button, which commits the bill (BIL-36); the method currently picked is recorded at once as the last selected one for the overnight commit (BIL-7). — #251
- **CHK-16** While the QR-Rechnung is picked on Bezahlen, the QR code, the account and the reference of the QR slip are shown on screen, on every device. — ADR-0020
- **CHK-17** After confirming — or, for a CHF 0 checkout, after its single button (BIL-8) — the person is told the checkout is complete, and what follows depends on where they are — ADR-0022, #419, #463:

  | Where | Offered | Then |
  |---|---|---|
  | the kiosk | "Fertig", filling over 8 s and then pressing itself | the kiosk resets (KIO-8) |
  | an own device, as a guest | "Fertig", filling over 8 s and then pressing itself | the guest is signed out and back on the check-in |
  | an own device, signed in | "Neuer Besuch starten" or "Vergangene Besuche", without countdown | a fresh check-in, still signed in — or the account's Nutzungsverlauf |

## Open questions

- [NEEDS CLARIFICATION] A person who signs in on the check-in of their own device while a checkout of theirs is open stays on the check-in, its persons filled from that checkout, instead of landing on Kosten (CHK-2); the same sign-in at the kiosk lands on Kosten (KIO-1). Intended?
- [NEEDS CLARIFICATION] Only the app keeps a person to one open checkout (CHK-7); nothing on the server refuses a second one when two devices check in at once. Intended?
- [NEEDS CLARIFICATION] *Freiwilligengruppe* and *Interne Nutzung* are not offered to a guest (CHK-4), but only the app withholds them; the server accepts them from anyone. Should the server refuse them too? — #570
- [NEEDS CLARIFICATION] A person added by name who returns the same day pays the usage fee again (CHK-12): without an account link there is nothing to match them on. Intended, or should the same name on the same account count?
- [NEEDS CLARIFICATION] An identified person who only accompanies someone (a parent with a child) pays the usage fee too, since they stay on the check-in (CHK-10). A per-person accompaniment option is #605.
- [NEEDS CLARIFICATION] Bezahlen preselects the first offered method and records it as the person's selection at once (CHK-15), so a person who leaves without touching anything is committed overnight with that method — the QR-Rechnung only when it comes first in the configured order (BIL-2, BIL-7). Intended? — #750
- [NEEDS CLARIFICATION] Bezahlen offers the PDF download (BIL-15) as soon as the checkout closed: before the PDF exists the download fails with an error, and a PDF fetched before confirming carries the QR slip even when TWINT or the Sammelrechnung is confirmed afterwards (the PDF is regenerated at commit). Should the download wait for the commit? — #750
- [NEEDS CLARIFICATION] A guest on their own device gets the same 8 s countdown as the kiosk (CHK-17) and is then signed out and back on the check-in — on a phone the completion vanishes while they may still be reading it. Intended? — #750
- [NEEDS CLARIFICATION] Bezahlen exists only in the session that closed the checkout: after a reload, the browser's back or a deep link there is no open checkout, the person is told so and sent to the check-in, the method can no longer be confirmed, and the bill is committed overnight (BIL-7). Intended?

## Retired

<!-- `- CHK-n — <PR that retired it>` -->
