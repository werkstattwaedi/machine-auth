# Account & sign-in

How a person signs in — e-mail code, SMS code, Google or badge — where each
works, and what a first sign-in asks for. Terms: see the
[glossary](README.md#glossary).

## Ways to sign in

- **ACC-1** A person signs in with an e-mail code, an SMS code, Google or a badge; which of them a device offers is fixed — ADR-0022, ADR-0031:

  | Way | Own device | Kiosk | Needs |
  |---|---|---|---|
  | e-mail code | yes | yes | an account; a new e-mail address can create one |
  | SMS code | yes | yes | a mobile number verified on the profile; no account is created by phone |
  | Google | yes | no | — |
  | badge tap | no | yes | a registered badge (unregistered: KIO-13) |

- **ACC-3** The link in the e-mail-code mail signs in the device that opens it. — ADR-0021

## First sign-in

- **ACC-2** A signed-in person without a complete profile completes the welcome onboarding before anything else, on an own device and at the kiosk alike. — ADR-0022, #595

## Open questions

- [NEEDS CLARIFICATION] A badge tapped on a phone is refused with a generic "could not be read" error; ADR-0022 promised a message that sends the person to the kiosk. Rule or gap?

## Retired

<!-- `- ACC-n — <PR that retired it>` -->
