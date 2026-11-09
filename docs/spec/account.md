# Account & sign-in

How a person signs in — e-mail code, SMS code, Google or badge — where each
works, what a first sign-in asks for, what a badge tap reaches at the
kiosk, and the Nutzungsverlauf. Terms: see the [glossary](README.md#glossary).

## Ways to sign in

- **ACC-1** A person signs in with an e-mail code, an SMS code, Google or a badge; each device offers a fixed set of them — ADR-0022, ADR-0031:

  | Way | Own device | Kiosk | Needs |
  |---|---|---|---|
  | e-mail code | yes | yes | an account; a new e-mail address can create one |
  | SMS code | yes | yes | a mobile number verified on the profile; a phone number alone creates no account |
  | Google | yes | no | — |
  | badge tap | no | yes | a registered badge (unregistered: KIO-13) |

- **ACC-3** The link in the e-mail-code mail signs in the device that opens it. — ADR-0021

## First sign-in

- **ACC-2** A signed-in person without a complete profile completes the welcome onboarding before anything else, on an own device and at the kiosk alike — a restricted session after a code (ACC-4). — ADR-0022, #595, #849

## At the kiosk

- **ACC-4** A restricted session reaches the checkout; the account, buying a badge (MEM-38) and the welcome onboarding (ACC-2) only after a code (ACC-5). — ADR-0041, #849
- **ACC-5** At the kiosk, an e-mail or SMS code opens for 15 min what a restricted session reaches only after one (ACC-4); it is entered at sign-in (ACC-1), or asked for when that is wanted without a code. — ADR-0041, #849

## Nutzungsverlauf

- **ACC-6** The Nutzungsverlauf lists each of the person's checkouts awaiting payment (BIL-49), with its amount, as a payment still being confirmed. — #812

## Open questions

- [NEEDS CLARIFICATION] A restricted session with an incomplete profile whose account has neither an e-mail address nor a mobile number verified for SMS sign-in can't enter a code (ACC-5), so it can't complete the welcome onboarding at the kiosk (ACC-2, ACC-4). What does it get instead — and the same for a person who cancels the code? — #849
- [NEEDS CLARIFICATION] A badge tapped on a phone is refused with a generic "could not be read" error; ADR-0022 promised a message that sends the person to the kiosk. Rule or gap?

## Retired

<!-- `- ACC-n — <PR that retired it>` -->
