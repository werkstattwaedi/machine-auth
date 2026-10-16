# Visit & checkout

Checking in, when a visit begins, the persons on it, usage types and the
usage fee — as it holds on any device; what differs at the kiosk is in
[kiosk.md](kiosk.md). Terms: see the [glossary](README.md#glossary).

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

- **CHK-10** On the check-in, a person can be removed only while someone else stays; the identified person and the family members they added (MEM-22) can each go only while another of them stays — #209:

  | Removed | Allowed while |
  |---|---|
  | the identified person | a family member they added is on the check-in |
  | a family member added from the roster | the identified person or another family member is on the check-in |
  | any other person | anyone else is on the check-in |

- **CHK-11** When a checkout is closed, a person on it stays linked to their account only as the account holder or as a family member added from the roster (MEM-22); every other person is recorded by name alone. — #741

## Usage fee

- **CHK-12** A second visit of the same account on one day charges no usage fee again for its account holder, or for a family member added from the roster (MEM-22), who was already charged it that day; a person added by name pays it on every visit. — #268

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

- **CHK-8** The server refuses a usage type that would waive what the checkout contains — #284:

  | Usage type | Refused when the checkout contains |
  |---|---|
  | *Nur Materialbezug* | machine time; the option is shown greyed out with the reason (#628) |
  | *Interne Nutzung* | a paid badge (a membership: MEM-6) |

- **CHK-5** A membership or badge bought without a visit opens a purchase-only checkout, whose usage type is *Nur Materialbezug* and which carries no usage fee (CHK-4). — ADR-0030, #660

## Open questions

- [NEEDS CLARIFICATION] A person who signs in on the check-in of their own device while a checkout of theirs is open stays on the check-in, its persons filled from that checkout, instead of landing on Kosten (CHK-2); the same sign-in at the kiosk lands on Kosten (KIO-1). Intended?
- [NEEDS CLARIFICATION] Only the app keeps a person to one open checkout (CHK-7); nothing on the server refuses a second one when two devices check in at once. Intended?
- [NEEDS CLARIFICATION] *Freiwilligengruppe* and *Interne Nutzung* are withheld from a guest by the app only (CHK-4); the server accepts them from anyone. Should the server refuse them too? — #570
- [NEEDS CLARIFICATION] A person added by name who returns the same day pays the usage fee again (CHK-12): without an account link there is nothing to match them on. Intended, or should the same name on the same account count?

## Retired

<!-- `- CHK-n — <PR that retired it>` -->
