# Kiosk

What differs at the shared terminal: where a badge tap lands, "Besuch
starten" next to "Material erfassen", what a second badge does, and when
the kiosk resets. The check-in itself follows [checkout.md](checkout.md)
(CHK), the ways to sign in [account.md](account.md) (ACC). Terms: see the
[glossary](README.md#glossary).

## Check-in

- **KIO-1** A badge tap or a code sign-in at the kiosk by a person with an open checkout lands on Kosten, or on Check Out for a checkout from an earlier day, like opening the app (CHK-2). — #463
- **KIO-2** On the kiosk check-in, an identified person without an open checkout has two buttons: "Besuch starten" and "Material erfassen". — #463, #467, ADR-0031
- **KIO-12** A guest at the kiosk has only "Weiter", as on an own device (CHK-3). — #467

## Starting a visit

- **KIO-9** "Besuch starten" starts the visit (CHK-3) and resets the kiosk at once (KIO-8). — #732
- **KIO-10** After a badge tap, "Besuch starten" fills up over 5 s and then presses itself; the filling button is the only hint — #732:

  | After | Countdown |
  |---|---|
  | a badge tap by a person without an open checkout | yes |
  | a badge tap by a person with an open checkout | no |
  | a badge tap that first runs the welcome onboarding (ACC-2) | no |
  | a code sign-in | no |

- **KIO-11** A touch anywhere on the screen, or a dialog opening, stops the countdown; "Besuch starten" stays and now has to be pressed. — #732
- **KIO-17** A stopped countdown does not start again on that check-in. — #732
- **KIO-3** "Material erfassen" continues to Kosten on the kiosk, like "Weiter" on an own device (CHK-3). — #463
- **KIO-5** A person with a started visit (CHK-9) sees only "Material erfassen" on the kiosk check-in. — #465, #732
- **KIO-18** A person with an open purchase-only checkout (CHK-5) sees both buttons, and they act on that checkout — #666, #732:

  | Button | The purchase-only checkout |
  |---|---|
  | "Besuch starten" | becomes a visit of type *Reguläre Nutzung* |
  | "Material erfassen" | stays as it is; the usage type is chosen on Check Out (CHK-4) |

## Second badge

- **KIO-6** A registered badge tapped while someone is at the kiosk — #463, #468, #689, #732, #752, ADR-0030:

  | Situation at the kiosk | Reaction |
  |---|---|
  | the start screen, or a guest who has entered nothing | the badge is checked in (CHK-1) |
  | a guest has entered persons or items | asked whether to discard the guest's checkout; on "Verwerfen" it is lost |
  | "Besuch starten" is still filling after a badge tap (KIO-10), or a start is under way | that visit is started, then the kiosk switches to the new badge without asking; the new person's screen says whose visit was started (KIO-16) |
  | that start fails or takes longer than 8 s | the person is told that the start failed, then asked as in the next row |
  | an identified person is on the check-in, no visit started, no countdown running | asked "Benutzer wechseln?" and told that no visit was started and that what is on the screen is lost |
  | an identified person is on the check-in with a started visit, or on Kosten or Check Out | asked "Benutzer wechseln?" and told that the open checkout is kept and continues on their next badge tap (KIO-1) |
  | an identified person is on Bezahlen, or on a page outside the checkout steps | the kiosk switches to the new badge without asking |
  | someone is in the account | the tap does nothing |

- **KIO-13** An unregistered badge never switches the kiosk to another person — ADR-0030:

  | Situation at the kiosk | Reaction |
  |---|---|
  | the start screen, or a guest who has entered nothing | the person is told to sign in first; once signed in, they are offered to buy the badge |
  | an identified person is at the kiosk | they are offered to buy the badge |
  | a guest has entered persons or items | the guest is told to finish the checkout and sign in first |

## Idle & reset

- **KIO-7** A kiosk left untouched for the idle time asks whether the person is still there; answering that they are not, or no answer within 30 s, resets the kiosk (KIO-8) — ADR-0022, ADR-0041, #378, #689:

  | Where | Idle time |
  |---|---|
  | the check-in and the steps after it, with an identified person | 5 min |
  | the check-in and the steps after it, with a guest who has entered persons or items | 5 min |
  | the account | 2 min |
  | the start screen, or a guest who has entered nothing | none |

- **KIO-8** A reset signs the person out, clears everything they entered and hides the kiosk until the next badge tap; a switch to another badge (KIO-6) keeps it open on the new person's check-in — ADR-0022, #415, #516, #689:

  | Trigger | Asked first |
  |---|---|
  | "Besuch starten" | no |
  | "Fertig" after paying, or 8 s without it | no |
  | the idle time ran out (KIO-7) | yes: whether the person is still there |
  | a switch to another badge | see KIO-6 |
  | "Abmelden" in the header menu | no |
  | "Neuer Checkout" in the kiosk frame | only a guest with an open checkout |

- **KIO-14** An identified person's open checkout survives a reset and continues on their next badge tap or code sign-in (KIO-1). — ADR-0022, #415, #689
- **KIO-15** A guest's checkout does not survive a reset. — ADR-0022, #415, #689
- **KIO-16** When a second badge's tap started the previous person's visit (KIO-6), the new person's screen says for 6 s whose visit was started. — #732

## Open questions

- [NEEDS CLARIFICATION] After "Besuch starten" the kiosk hides itself (KIO-8), so nobody sees the start confirmation (KIO-16); it is seen only when a second badge took the start over. Should the kiosk stay open for those 6 s, or is no confirmation wanted there? — #732
- [NEEDS CLARIFICATION] After buying a badge on the check-in, nothing on the screen says that the badge is in the cart. — #666
- [NEEDS CLARIFICATION] A badge tap by a person whose open checkout is purchase-only lands on Kosten (KIO-1), where no visit can be started; "Besuch starten" exists on the check-in only (KIO-18). #666 plans to change where that tap lands.
- [NEEDS CLARIFICATION] After a touch stopped the countdown (KIO-11), tapping one's own badge again counts as a second badge (KIO-6): the person is asked whether to switch and told that no visit was started. Intended, or should the same badge start the visit or restart the countdown? — #732
- [NEEDS CLARIFICATION] A badge tap that first runs the welcome onboarding (ACC-2) gets no countdown afterwards (KIO-10). Should the countdown start once the profile is complete? — #732
- [NEEDS CLARIFICATION] A second badge over a check-in with a purchase-only checkout open tells the person that what is on the screen is lost (KIO-6), although that checkout is kept and comes back on their next tap (KIO-14). Should the dialog say so? — #732
- [NEEDS CLARIFICATION] A start that stalled past 8 s (KIO-6) can still land while "Benutzer wechseln?" is open: after a countdown or a click the kiosk then resets under the dialog and hides (KIO-8); after a tap alone the visit exists although the dialog said none was started. Should a stalled start be abandoned, or should the dialog follow the late start? — #732

## Retired

<!-- `- KIO-n — <PR that retired it>` -->
- KIO-4 — #739 (the "Besuch gestartet" dialog with "Fertig" or 8 s; "Besuch starten" now resets at once, KIO-9)
