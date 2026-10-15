# Kiosk

What differs at the shared terminal: where a badge tap lands, "Besuch
starten" next to "Material erfassen", what a second badge does, and when
the kiosk resets. The check-in itself follows [checkout.md](checkout.md)
(CHK), the ways to sign in [account.md](account.md) (ACC). Terms: see the
[glossary](README.md#glossary).

## Check-in

- **KIO-1** A badge tap or a code sign-in at the kiosk by a person with an open checkout lands where opening the app would (CHK-2): on Kosten, or on Check Out when the checkout is from an earlier day. — #463
- **KIO-2** On the kiosk check-in, an identified person without an open checkout has two buttons: "Besuch starten" and "Material erfassen". — #463, #467, ADR-0031
- **KIO-12** A guest at the kiosk has only "Weiter", as on an own device (CHK-3). — #467

## Starting a visit

- **KIO-4** "Besuch starten" starts the visit (CHK-3) and confirms it in a dialog; "Fertig", or 8 s without it, resets the kiosk (KIO-8). — #463
- **KIO-3** "Material erfassen" is the kiosk's "Weiter": it continues to Kosten at the kiosk (CHK-3). — #463
- **KIO-5** A person with an open checkout sees only "Material erfassen" on the kiosk check-in. — #465

## Second badge

- **KIO-6** A registered badge tapped while someone is at the kiosk — #463, #468, #689, ADR-0030:

  | Situation at the kiosk | Reaction |
  |---|---|
  | the start screen, or a guest who has entered nothing | the badge is checked in (CHK-1) |
  | a guest has entered persons or items | asked whether to discard the guest's checkout; on "Verwerfen" it is lost |
  | an identified person has entered nothing and has no open checkout | the kiosk switches to the new badge without asking |
  | an identified person has entered persons or items, or has an open checkout | asked "Benutzer wechseln?" and told that the open checkout is kept and continues on their next badge tap (KIO-1) |
  | someone is in the account | the tap does nothing |

- **KIO-13** An unregistered badge never switches the kiosk to another person — ADR-0030:

  | Situation at the kiosk | Reaction |
  |---|---|
  | the start screen, or a guest who has entered nothing | the person is told to sign in first; once signed in, they are offered to buy the badge |
  | an identified person is at the kiosk | they are offered to buy the badge |
  | a guest has entered persons or items | the guest is told to finish the checkout and sign in first |

## Idle & reset

- **KIO-7** A kiosk left untouched for the idle time asks whether the person is still there; "Besuch fortsetzen" keeps the session, "Neuen Besuch starten" or no answer within 30 s resets the kiosk (KIO-8) — ADR-0022, ADR-0041, #378, #689:

  | Where | Idle time |
  |---|---|
  | the check-in and the steps after it, with an identified person | 5 min |
  | the check-in and the steps after it, with a guest who has entered persons or items | 5 min |
  | the account | 2 min |
  | the start screen, or a guest who has entered nothing | none; the kiosk stays as it is |

- **KIO-8** A reset signs the person out, clears everything they entered and hides the kiosk until the next badge tap; a switch to another badge (KIO-6) keeps it open on the new person's check-in — ADR-0022, #415, #516, #689:

  | Trigger | Asked first |
  |---|---|
  | "Besuch starten" | no |
  | "Fertig" after paying, or 8 s without it | no |
  | the idle time ran out (KIO-7) | yes — whether the person is still there |
  | a switch to another badge (KIO-6) | as KIO-6 says |
  | "Abmelden" in the header menu | no |
  | "Neuer Checkout" in the kiosk frame | only a guest with an open checkout |

- **KIO-14** An identified person's open checkout survives a reset and continues on their next badge tap or code sign-in (KIO-1). — ADR-0022, #415, #689
- **KIO-15** A guest's checkout does not survive a reset. — ADR-0022, #415, #689

## Open questions

- [NEEDS CLARIFICATION] On 2026-10-14 the staging smoke run saw a second badge switch the kiosk without asking while the "Besuch gestartet" dialog (KIO-4) was still open, and nobody was told that the first visit had started; KIO-6 says such a tap asks first. Bug, or intended? — #732
- [NEEDS CLARIFICATION] Buying a badge on the check-in opens a purchase-only checkout (CHK-5); "Besuch starten" then disappears (KIO-5) although no visit is started, and nothing on the screen says so. Intended? — #666

## Retired

<!-- `- KIO-n — <PR that retired it>` -->
