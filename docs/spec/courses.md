# Courses

Courses booked in edoobox, as their course leaders run them in the checkout:
who sees them, linking participants to accounts, badges, the Präsenzstatus,
the temporary permission a course gives and the close that grants it for
good. What a permission unlocks is in [machine.md](machine.md) (MAC); where
an admin links course leaders and participants is in [admin.md](admin.md)
(ADM-17, ADM-18). Terms: see the [glossary](README.md#glossary).

## Access

- **CRS-1** Only a course leader sees Kursleitung in the account and can read or act on courses there; the server refuses everyone else. — #842
- **CRS-8** The server lets a course leader set a Präsenzstatus or link an account only for a participant of a course they lead, and assign a badge or change a permission choice only for that participant's linked account, never for their own. — #842

## Courses

- **CRS-2** Kursleitung lists the courses the course leader leads in edoobox that are not closed and are upcoming, running, or no more than 60 days past their last Termin. — #842
- **CRS-3** A course page shows the course — its Termine, its participants and their Präsenzstatus — as edoobox has it when the page opens; of a course, the checkout itself keeps only the pick of its permission (CRS-17), each participant's link to an account, the permission choices and the close. — #842
- **CRS-4** On the course page the course leader sets a participant's Präsenzstatus at a Termin to one of the statuses on offer — those the configuration names, by default Anwesend, Frühzeitig gegangen, Entschuldigt and Unentschuldigt — or clears it, and the change is written to edoobox at once; the server refuses setting it for a Termin that has not started. — #842

## Participants

- **CRS-5** For each participant the course page shows whether they have a linked account, a badge and, on a course that gives a permission (CRS-17), that permission, and names the next step: linking an account, else assigning a badge if they have none — except for the course leader's own account (CRS-8) and for a participant whose permission choice is Nein (CRS-10) who doesn't already hold the permission. — #842
- **CRS-6** A participant without a linked account shows their edoobox e-mail, which the course leader can correct for the match only (edoobox keeps its address), and whether an account with that e-mail exists; the course leader links that account if it does, or else creates one from the participant's edoobox name and that e-mail, links it and e-mails the participant how to use it, without the participant tapping a badge. — #842
- **CRS-7** A participant's link to an account is removed only by an admin (ADM-18); the server refuses linking a participant who is already linked, and linking one account to two participants of the same course. — #842
- **CRS-9** At the kiosk, assigning a badge waits for a tap and registers an unregistered badge to the participant's linked account, free and without a checkout, and refuses a registered badge and an account that already has a badge that isn't deactivated; on an own device the course leader is told to assign it at the kiosk, and nothing is assigned. — #842

## Permission

- **CRS-17** On the course page the course leader picks which permission the course gives — one of the permissions, or none — and can change the pick until the first participant is linked; the server refuses linking a participant or closing the course before the pick, and changing the pick after the first link, and what Kursleitung shows of the permission follows the pick — #842:

  | Pick | Kursleitung |
  |---|---|
  | not picked yet | the participant page says to pick the permission first instead of offering the link (CRS-6), and the course page offers no close (CRS-12) |
  | a permission | as in CRS-5 and CRS-10 to CRS-14 |
  | none | no permission, no permission choice and no "already holds" are shown, and none is given; the close takes no Ja or Nein and no reason, and only marks the course closed |

- **CRS-10** On a course that gives a permission (CRS-17), each linked participant has a permission choice — Nein, Vorläufig or Ja, starting on Vorläufig when linked, or on Nein for the course leader's own account (CRS-8) — which the course leader changes until the course is closed, each change saved at once, except for the course leader's own account and for a participant who already holds the permission, who is shown as such instead; Ja acts like Vorläufig until the close (CRS-11). — #842
- **CRS-11** Until the course is closed, the course gives a participant whose choice is Vorläufig or Ja its permission as a temporary permission, from the start of each Termin until 1 h after its end and at no other time, so it lapses after the last Termin even if the course is never closed, and gives, moves and ends it like this — #842:

  | When | Temporary permission |
  |---|---|
  | the participant is linked, or their choice changes to Vorläufig or Ja | given at once, for the Termine as edoobox has them then — unless they hold the permission temporarily from another course at that moment: then this course gives none, even once the other course's has lapsed, until their choice next changes to Vorläufig or Ja |
  | their choice changes to Nein | ended at once |
  | a Termin is added, moved or removed in edoobox | its windows follow the next morning |
  | their booking is cancelled in edoobox | ended the next morning |
  | an admin removed it (ADM-16), or it ended for a cancelled booking | stays ended until their choice next changes to Vorläufig or Ja |

## Closing a course

- **CRS-12** From the start of the last Termin, once the permission is picked (CRS-17), the course leader can close the course; the close shows beside each participant whether they attended no Termin or missed at least one — a Termin counts as attended when the participant's Präsenzstatus there has an *Anwesenheit* above 0 %, as missed when it has 0 %, and as neither without a status, so a participant without a status at any Termin attended none — and, on a course that gives a permission (CRS-17), whether they already hold it and a choice of Ja or Nein, which starts on the first row that applies — #842:

  | Participant | Choice starts as |
  |---|---|
  | no linked account | Nein, and it can't be changed |
  | linked to the course leader's own account (CRS-8) | Nein, and it can't be changed |
  | already holds the permission | Ja |
  | permission choice Vorläufig or Ja (CRS-10) | Ja |
  | permission choice Nein | Nein |

- **CRS-13** A Nein at the close takes a reason, prefilled by the first case that applies — no linked account, attended no Termin, missed at least one (CRS-12) — and otherwise empty; a reason given is written to edoobox as a note on the participant's booking, and a note that can't be written leaves the close in place and the course leader is told. — #842
- **CRS-14** The close grants each participant with Ja the permission for good (MAC-4) and ends the temporary permission of each with Nein (CRS-11), but never removes a permission a participant holds from an admin or from another course. — #842
- **CRS-15** Once a course is closed, its course page says when it was closed and is read-only, without next steps (CRS-5), and the server refuses the course leader every further change to it. — #842
- **CRS-16** While a course is not closed after its last Termin, each course leader who leads at least one of its Termine is e-mailed a reminder 1, 3 and 7 days after the last Termin, and on the 7th day the office is e-mailed once for the course. — #842

## Open questions

## Retired

<!-- `- CRS-n — <PR that retired it>` -->
