# Kiosk

What differs at the shared terminal: where a badge tap lands, "Besuch
starten" next to "Material erfassen", what a second badge does, paying by
TWINT or at the payment terminal, and when the kiosk resets. The check-in itself follows
[checkout.md](checkout.md) (CHK), the ways to sign in
[account.md](account.md) (ACC). Terms: see the
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
- **KIO-21** While every person on the kiosk check-in is on *Begleitung / nur Materialbezug*, "Besuch starten" can't be pressed and runs no countdown (KIO-10), and "Material erfassen" is the emphasised button instead; as soon as one person is on another usage type, "Besuch starten" is back as before. — ADR-0050, #758
- **KIO-18** A person with an open purchase-only checkout (CHK-9) sees both buttons, and they act on that checkout with the persons and usage types as entered on the check-in (CHK-4) — #666, #732, ADR-0050, #605:

  | Button | The purchase-only checkout |
  |---|---|
  | "Besuch starten" | becomes a visit by those types (CHK-9) — it can be pressed only once someone is on another usage type than *Begleitung / nur Materialbezug* (KIO-21) |
  | "Material erfassen" | continues to Kosten; it is a purchase-only checkout or a visit by those types (CHK-9) |

## Second badge

- **KIO-6** A registered badge tapped while someone is at the kiosk, unless a payment at the payment terminal is under way (KIO-24) — #463, #468, #689, #732, #750, #752, #769, ADR-0030, #735:

  | Situation at the kiosk | Reaction |
  |---|---|
  | the start screen, or a guest who has entered nothing | the badge is checked in (CHK-1) |
  | a guest has entered persons or items, before the commit (CHK-22) | asked whether to discard the guest's checkout; on "Verwerfen" it is lost |
  | "Besuch starten" is still filling after a badge tap (KIO-10), or a start is under way | that visit is started, then the kiosk switches to the new badge without asking; the new person's screen says whose visit was started (KIO-16) |
  | that start fails or takes longer than 8 s | the person is told that the start failed, then asked as in the next row |
  | an identified person is on the check-in, no visit started, no countdown running | asked "Benutzer wechseln?" and told that no visit was started and that what is on the screen is lost |
  | an identified person is on the check-in with a started visit, or on Kosten, Check Out or Bezahlen before the commit (CHK-22) | asked "Benutzer wechseln?" and told that the open checkout is kept and continues on their next badge tap (KIO-1) |
  | an identified person's or a guest's checkout is committed (CHK-22) or the payment terminal approved its payment (KIO-22), or an identified person is on a page outside the checkout steps | the kiosk switches to the new badge without asking |
  | someone is in the account | the tap does nothing |

- **KIO-13** An unregistered badge never switches the kiosk to another person; unless a payment at the payment terminal is under way (KIO-24), it is answered like this — ADR-0030, #769, #735:

  | Situation at the kiosk | Reaction |
  |---|---|
  | the start screen, or a guest who has entered nothing | the person is told to sign in first; once signed in, they are offered to buy the badge |
  | an identified person is at the kiosk | they are offered to buy the badge |
  | a guest has entered persons or items, before the commit (CHK-22) | the guest is told to finish the checkout and sign in first |
  | a guest's checkout is committed (CHK-22) or the payment terminal approved its payment (KIO-22) | the kiosk returns to the start screen, which reacts as in the first row |

## Paying

- **KIO-19** At the kiosk the TWINT paylink opens in an overlay on the kiosk itself; TWINT is committed when it opens (CHK-22), and what happens in the overlay changes nothing on the bill (BIL-6). — #416, #750
- **KIO-20** After TWINT is committed at the kiosk, "Fertig" does not start its 8 s countdown (CHK-26) until the overlay reports the payment done; until then it waits to be pressed, and the idle reset (KIO-7) still applies. — #416, #750
- **KIO-22** Choosing *Karte / TWINT* starts a payment at the payment terminal at once, for the amount priced at that moment (BIL-40), which Bezahlen shows; there is nothing to commit on the screen, and Bezahlen follows the terminal — ADR-0051, #735, #792:

  | The terminal | The person is told | Offered |
  |---|---|---|
  | waits for a card or TWINT | that it waits | "Abbrechen", which stops the terminal and returns to Check Out (CHK-21) |
  | has read a card or TWINT | that the payment is running | nothing: Bezahlen can't be left until the terminal answers |
  | approved the payment | that it is paid (CHK-23) — on the terminal's word, without waiting for Wallee's confirmation (BIL-39) | "Fertig" (CHK-26) |
  | declined it, or it was stopped at the terminal | that it was declined | "Nochmals versuchen", which starts a new payment at the terminal, or "Zurück" (CHK-21) |
  | read no card in time | that no card was read | the same |
  | can't take it — unreachable, busy with another payment, or any other error | that paying is not possible, and why | the same |
  | lost its connection during the payment | see KIO-23 | |

- **KIO-23** When the connection to the payment terminal drops during a payment, Bezahlen says the payment is being checked and watches the checkout: whenever Wallee's confirmation closes it, the payment is shown as paid (KIO-22); after 10 s without it the person is told that no payment arrived and, should the terminal show it as paid, to contact the team instead of paying again, with "Nochmals versuchen" and "Zurück" as after a declined payment. — ADR-0051, #735, #792
- **KIO-24** While a payment at the payment terminal is being started, waits for a card, runs or is being checked (KIO-22, KIO-23), a badge tap — registered or not — changes nothing at the kiosk, and the person is told to finish the payment at the terminal first. — #735, #792

## Idle & reset

- **KIO-7** A kiosk left untouched for the idle time asks whether the person is still there; saying yes keeps the session, any other answer or none within 30 s resets the kiosk (KIO-8) — ADR-0022, ADR-0041, #378, #689:

  | Where | Idle time |
  |---|---|
  | the check-in and the steps after it, with an identified person | 5 min |
  | the check-in and the steps after it, with a guest who has entered persons or items | 5 min |
  | the account | 2 min |
  | the start screen, or a guest who has entered nothing | none |

- **KIO-8** A reset signs the person out, clears everything they entered and hides the kiosk until the next badge tap; a switch to another badge (KIO-6) keeps it open on the new person's check-in, and an unregistered badge over a guest's committed checkout (KIO-13) keeps it open on the start screen — ADR-0022, #415, #516, #689, #750, #769:

  | Trigger | Asked first |
  |---|---|
  | "Besuch starten" | no |
  | "Fertig" after the commit or the payment terminal's approval, or 8 s without it unless held (CHK-26, KIO-20) | no |
  | the idle time ran out (KIO-7) | yes: whether the person is still there |
  | a switch to another badge | see KIO-6 |
  | an unregistered badge over a guest's committed checkout (KIO-13) | no |
  | "Abmelden" in the header menu | no |
  | "Neuer Checkout" in the kiosk frame | only a guest with an open checkout |

- **KIO-25** A reset (KIO-8) also stops the payment terminal if it still waits for a card. — #735, #792
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
- [NEEDS CLARIFICATION] A second registered badge while a RaiseNow payment is still in the overlay (KIO-20) switches the kiosk without asking, since RaiseNow is committed when the overlay opens (KIO-6, KIO-19); the switch does not close the overlay. What a badge tap during a payment does is for #735 to decide.

## Retired

<!-- `- KIO-n — <PR that retired it>` -->
- KIO-4 — #739 (the "Besuch gestartet" dialog with "Fertig" or 8 s; "Besuch starten" now resets at once, KIO-9)
