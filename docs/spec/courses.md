# Courses

Courses booked in edoobox, as their course leaders run them in the checkout:
who sees them, linking participants to accounts, badges, the Präsenzstatus,
the temporary permissions a course gives and the close that grants them for
good. What a permission unlocks is in [machine.md](machine.md) (MAC); where
an admin links course leaders and participants is in [admin.md](admin.md)
(ADM-17, ADM-18). Terms: see the [glossary](README.md#glossary).

## Access

- **CRS-1** Only a course leader sees Kursleitung in the account and can read or act on courses there; the server refuses everyone else. — #842
- **CRS-8** The server lets a course leader set a Präsenzstatus or link an account only for a participant of a course they lead, and assign a badge or change a permission choice only for that participant's linked account, never for their own. — #842

## Courses

- **CRS-2** Kursleitung lists the courses that are not closed and of which the course leader leads, in edoobox, a Termin that ended no more than 60 days ago or hasn't ended yet — a course past its last Termin only until 60 days after that Termin's end. — #842
- **CRS-3** A course page shows the course — its Termine, its participants and their Präsenzstatus — as edoobox has it when the page opens; of a course, the checkout itself keeps only the pick of its permissions (CRS-17), each participant's link to an account, the permission choices, the close, which reminders went out (CRS-16), and copies of edoobox data: for the admin's list (ADM-18) the course title and the participant's name as at linking, for the reminder mails the course title as at the latest pick, link or close (else the first reminder). — #842
- **CRS-4** On the course page the course leader sets a participant's Präsenzstatus at a Termin to one of the statuses on offer — those the configuration names, by default Anwesend, Frühzeitig gegangen, Entschuldigt and Unentschuldigt — or clears it, and the change is written to edoobox at once; the server refuses setting it for a Termin that has not started. — #842

## Participants

- **CRS-19** Kursleitung counts and shows as a course's participants — on the list, the course page and the close — only those whose booking in edoobox is neither cancelled nor on the waiting list, and the server refuses every action on anyone else, except that the close ends their temporary permissions (CRS-14). — #842
- **CRS-5** For each participant the course page shows whether they have a linked account, a badge and, on a course that gives any permission (CRS-17), their permission choice or that they already hold the course's permissions (CRS-10), and names the next step: linking an account, else assigning a badge if they have none — except for the course leader's own account (CRS-8) and for a participant whose permission choice is Nein who doesn't already hold the course's permissions. — #842
- **CRS-6** A participant without a linked account shows their edoobox e-mail, which the course leader can correct for the match only (edoobox keeps its address), and whether an account with that e-mail exists; the course leader links that account if it does, or else creates one from the participant's edoobox name and that e-mail, links it and e-mails the participant how to use it, without the participant tapping a badge. — #842
- **CRS-7** A participant's link to an account is removed only by an admin (ADM-18) or because edoobox no longer has its course or booking (CRS-18); the server refuses linking a participant who is already linked, and linking one account to two participants of the same course. — #842
- **CRS-9** At the kiosk, assigning a badge waits for a tap and registers an unregistered badge to the participant's linked account, free and without a checkout, and refuses a registered badge and an account that already has a badge that isn't deactivated; on an own device the course leader is told to assign it at the kiosk, and nothing is assigned. — #842
- **CRS-18** A participant's link to an account is kept only while edoobox still has the course and a booking of the participant on it, a cancelled one or one on the waiting list included; every Sunday morning the links whose course or booking edoobox reports gone are removed — none when edoobox can't be reached — which ends the participant's temporary permissions from that course (CRS-11) but leaves the permissions its close granted for good (CRS-14), and the course's pick and close (CRS-3) stay. — #842

## Permission

- **CRS-17** On the course page the course leader picks which permissions the course gives — any number of the permissions, or none — and can change the pick while no participant is linked, before the first link or again once every link is removed (ADM-18, CRS-18); the server refuses linking a participant or closing the course before the pick, and changing the pick while a participant is linked, and what Kursleitung shows of the permissions follows the pick — #842:

  | Pick | Kursleitung |
  |---|---|
  | not picked yet | the participant page says to pick the permissions first instead of offering the link (CRS-6), and the course page offers no close (CRS-12) |
  | one or more permissions | as in CRS-5 and CRS-10 to CRS-14 |
  | none | no permission, no permission choice and no "already holds" are shown, and none is given; the close takes no Ja or Nein and no reason, and only marks the course closed |

- **CRS-10** On a course that gives any permission (CRS-17), each linked participant has one permission choice for all of the course's permissions — Nein, Vorläufig or Ja, starting on Vorläufig when linked, or on Nein for the course leader's own account (CRS-8) — which the course leader changes until the course is closed, each change saved at once, except for the course leader's own account and for a participant who already holds every one of the course's permissions for good (MAC-4), other than from this course, who is shown as such instead; Ja acts like Vorläufig until the close (CRS-11). — #842
- **CRS-11** Until the course is closed, the course gives a participant whose choice is Vorläufig or Ja each of its permissions as a temporary permission that holds from the start of each Termin until 1 h after its end and at no other time — so none after the last Termin, even if the course is never closed — and gives, moves and ends it like this — #842:

  | When | Temporary permission |
  |---|---|
  | the participant is linked, or the course leader sets their choice to Vorläufig or Ja, even to the one it already is | given at once, for the Termine as edoobox has them then — except a permission they hold at that moment for good, or temporarily from another course with a window still to come: of that one this course gives none until their choice is next set to Vorläufig or Ja, or the next row applies |
  | they still hold another course's temporary permission, of which this course gave none, after all its windows have ended | this course's replaces it the next morning |
  | their choice is set to Nein | ended at once |
  | a Termin is added, moved or removed in edoobox, also after the last Termin | its windows follow the next morning — unless, once all its windows had ended, another course's replaced it |
  | their booking is cancelled or moved to the waiting list in edoobox | ended the next morning |
  | an admin removed it (ADM-16), or it ended for a booking cancelled or moved to the waiting list | stays ended, also when the booking is restored in edoobox, until their choice is next set to Vorläufig or Ja |

## Closing a course

- **CRS-12** From the start of the last Termin, once the course's permissions are picked (CRS-17), the course leader can close the course; the close shows beside each participant whether they attended no Termin or missed at least one — a Termin counts as attended when the participant's Präsenzstatus there has an *Anwesenheit* above 0 %, as missed when it has 0 %, and as neither without a status, so a participant without a status at any Termin attended none — and, on a course that gives any permission (CRS-17), whether they already hold the course's permissions (CRS-10) and one choice of Ja or Nein for all of them, which starts on the first row that applies — #842:

  | Participant | Choice starts as |
  |---|---|
  | no linked account | Nein, and it can't be changed |
  | linked to the course leader's own account (CRS-8) | Nein, and it can't be changed |
  | already holds the course's permissions (CRS-10) | Ja |
  | permission choice Vorläufig or Ja (CRS-10) | Ja |
  | permission choice Nein | Nein |

- **CRS-13** A Nein at the close takes a reason, prefilled by the first case that applies — no linked account, attended no Termin, missed at least one (CRS-12) — and otherwise empty; a reason given is written to edoobox as a note on the participant's booking, and a note that can't be written leaves the close in place and the course leader is told. — #842
- **CRS-14** The close grants each participant with Ja every one of the course's permissions for good (MAC-4) and ends the course's temporary permissions (CRS-11) of every other account linked to the course — one with Nein, one whose booking was cancelled or moved to the waiting list, one linked while the close was open — but never removes a permission a participant holds from an admin or from another course. — #842
- **CRS-15** Once a course is closed, its course page says when it was closed and is read-only, without next steps (CRS-5), and the server refuses the course leader every further change to it. — #842
- **CRS-16** While a course is not closed after its last Termin, each course leader whose Kursleitung lists it (CRS-2) is e-mailed a reminder 1, 3 and 7 days after the last Termin, and on the 7th day the office is e-mailed once for the course. — #842

## Open questions

## Retired

<!-- `- CRS-n — <PR that retired it>` -->
