# Machine terminal

Unlocking a machine at its machine terminal, what the terminal tells a person
it doesn't let in, the permissions a machine requires and a person holds, and
how a machine session ends and what of it is billed.
Where the team grants them is in [admin.md](admin.md) (ADM-16), how a course
grants them in [courses.md](courses.md) (CRS); what a permission does for the
price of a badge is MEM-14. Terms: see the [glossary](README.md#glossary).

## Permissions

- **MAC-1** A machine terminal unlocks a machine only for a badge whose account holds every permission the machine requires — for good (MAC-4) or temporarily from a course (CRS-11) — an admin's account included, except a badge it lets in again under MAC-3; a machine that requires none asks for none. — #154, #842, #843
- **MAC-4** A person holds a permission for good when an admin grants it — to anyone, themselves included — or the close of a course grants it (CRS-14), and then until an admin removes it; a temporary permission comes only from a course (CRS-11). — #512, #842, #843
- **MAC-3** For up to 4 h after the server last let a badge in at a machine terminal, that terminal lets the same badge in again without asking the server, so a refusal the server would give in that time — such as for a permission removed (MAC-4) or a temporary one past its window (CRS-11), a deactivated badge or an open checkout from an earlier day (MAC-5) — does not stop it there. — #843

## Refusals

- **MAC-5** A machine terminal doesn't unlock any machine, whatever it requires, for a badge whose account has an open checkout from an earlier day, except a badge it lets in again under MAC-3. — #393
- **MAC-6** When the server refuses a badge at a machine terminal, the terminal tells the person why and, where the table says so, offers "Info", which shows a QR code of a page in the checkout app about the refusal — #535, #580:

  | The server refuses because | The person is told | "Info" |
  |---|---|---|
  | the badge isn't registered | that the badge isn't registered | no |
  | the badge is deactivated | that the badge is deactivated | no |
  | a permission the machine requires is missing (MAC-1) | that this machine needs a further permission | yes |
  | of an open checkout from an earlier day (MAC-5) | to close that visit first, with the day it was opened | yes |
  | anything else | only that they can't use this machine right now | no |

- **MAC-7** When the badge leaves the reader before the machine terminal has finished checking it, the machine stays locked and the terminal asks the person to hold the badge on longer. — #536
- **MAC-8** A refusal (MAC-6) or the request to hold the badge longer (MAC-7) stays on the machine terminal's screen until the person presses OK, taps a badge again, or 20 s have passed with the badge off the reader and the QR code (MAC-6) closed. — #580
- **MAC-9** When a machine terminal gets no answer from the server while it checks a badge, the machine stays locked and the terminal tells the person that it has no connection and to try again in a moment, without "Info" (MAC-6), the notice staying on the screen as a refusal does (MAC-8). — #865

## Machine sessions

- **MAC-16** When a badge the machine terminal lets in (MAC-1) is tapped during a machine session, the terminal asks the question in the table; holding the badge on for 1 s after the question appears, or "Ja", does what the table says, while taking it off and then 3 s passing, or "Nein", leaves the session running — #534:

  | The badge is | The terminal asks | It then |
  |---|---|---|
  | the one that started the session | whether to end the session | ends the session |
  | another person's | whether to sign that person in | ends the session and starts one for that person |

- **MAC-15** During a machine session, "Stopp" on the machine terminal asks whether to end it, with "Ja" filling up over 3 s; "Ja" or the 3 s running out ends the session, "Nein" leaves it running.

## Sensed machines

- **MAC-10** The billed time of a machine session (CHK-44) is, on a sensed machine, the time within it in which the machine was in use, and on any other machine the session's whole length. — ADR-0032, ADR-0035
- **MAC-11** During a machine session the machine terminal shows whether the machine is in use — a machine that isn't sensed counts as in use throughout — and, once it has been in use, the billed time so far (MAC-10). — ADR-0032
- **MAC-12** A machine session on a sensed machine ends by itself once the machine hasn't been in use for the machine's idle time — 15 min unless set otherwise for that machine — counted from the session's start, the machine's last use or the last "Weiter" (MAC-13), whichever is latest; a session on any other machine never ends for lack of use. — ADR-0032, ADR-0035
- **MAC-13** For the machine's warning time before a sensed machine's session ends by itself (MAC-12) — 1 min unless set otherwise for that machine — the machine terminal asks whether the person is still working, with "Beenden" filling up until the end; "Beenden" ends the session at once, while "Weiter" or the machine coming into use again leaves it running. — ADR-0032
- **MAC-14** While the machine terminal of a sensed machine can't learn whether the machine is in use — the machine, or the gateway it is reached through, doesn't answer — it counts the machine as not in use, so that time is not billed (MAC-10) and counts toward the idle time (MAC-12). — ADR-0035

## Open questions

- [NEEDS CLARIFICATION] The Profil page of the account lists every permission and marks the ones the person holds; nothing records that decision. Rule?
- [NEEDS CLARIFICATION] A tag the machine terminal can't authenticate as a badge of the workshop — another card, or a badge it can't read — gets a red light and a low tone but no message on the screen, unlike an unregistered badge (MAC-6). Rule?
- [NEEDS CLARIFICATION] On a sensed machine, a question about ending the session (MAC-15, MAC-16) that leaves the session running starts the idle time (MAC-12) over, as "Weiter" does (MAC-13); nothing records that decision. Intended?
- [NEEDS CLARIFICATION] During a machine session, a badge the server refuses (MAC-6) or doesn't answer for (MAC-9) gets a red light and a low tone but no message on the screen; that includes the badge that started the session once MAC-3's 4 h have passed, which then can't end it (MAC-16) — only "Stopp" can (MAC-15). Rule, or should MAC-6 and MAC-9 hold during a session too?

## Retired

<!-- `- MAC-n — <PR that retired it>` -->
- MAC-2 — #842 (course leaders grant permissions too; replaced by MAC-4)
