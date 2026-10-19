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

- **ACC-2** A signed-in person without a complete profile completes the welcome onboarding before anything else, on an own device and at the kiosk alike. — ADR-0022, #595

## At the kiosk

- **ACC-4** A restricted session reaches the checkout but not the account. — ADR-0041
- **ACC-5** At the kiosk, an e-mail or SMS code opens the account for 15 min, entered at sign-in (ACC-1) or when a restricted session opens an account page. — ADR-0041
- **ACC-6** The code that opens the account for a restricted session (ACC-5) goes only to the account's own e-mail address or its verified mobile number; no other address or number can be entered for it. — ADR-0041
- **ACC-7** When a restricted session opens an account page, the e-mail address and the mobile number the code can go to (ACC-6) are shown only masked: of the e-mail address the first two characters of the name and of the domain plus the top-level domain, of the number the country code, the first two and the last two digits. — ADR-0041
- **ACC-8** At the kiosk, while the account is not open (ACC-5), the check-in and the header menu show the e-mail address of every person with an account only masked as in ACC-7; once it is open, they show it in full. — #668

## Nutzungsverlauf

- **ACC-6** The Nutzungsverlauf lists each of the person's checkouts awaiting payment (BIL-49), with its amount, as a payment still being confirmed. — #812

## Open questions

- [NEEDS CLARIFICATION] A badge tapped on a phone is refused with a generic "could not be read" error; ADR-0022 promised a message that sends the person to the kiosk. Rule or gap?
- [NEEDS CLARIFICATION] While the account is not open at the kiosk (ACC-8), Bezahlen still names the full e-mail address the document went to (CHK-23), so a found badge reveals it after the commit. Mask it there too? — #668
- [NEEDS CLARIFICATION] A badge tap that first runs the welcome onboarding (ACC-2) shows the account's full e-mail address, its stored mobile number and its billing address on the data step, and the e-mail address again once the instructions mail is sent, although the account is not open (ACC-8). Intended? — #668

## Retired

<!-- `- ACC-n — <PR that retired it>` -->
