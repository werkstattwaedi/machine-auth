# Admin app

What the team sees and does in the admin app. Terms: see the
[glossary](README.md#glossary).

## Visits

- **ADM-1** The admin app marks a checkout awaiting payment (BIL-49) as such, shows the amount the Wallee terminal approved, and can list only those checkouts. — #812

## Material labels

- **ADM-2** An admin prints one material label from a catalog item's page, or every label in the cart of the *Etiketten* tab in one go, and sees each label's preview, as it will print, beforehand. — ADR-0033, #337, #490
- **ADM-3** A material label carries the item's code, its label name (else its display name), its label mass if it has one, and a QR code linking to the item in the checkout. — ADR-0026, #562, #593
- **ADM-4** The admin app prints every material label on 18 mm tape, 72 mm long. — #593
- **ADM-5** A material label's length doesn't depend on its content: a name too long for it shrinks, and only a name still too long at the smallest size lengthens the label rather than being cut off. — #593
- **ADM-6** When the tape loaded in the printer isn't the one a label was made for, nothing prints and the admin is told why. — #337

## Retired

<!-- `- ADM-n — <PR that retired it>` -->
