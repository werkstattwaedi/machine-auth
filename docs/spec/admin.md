# Admin app

What the team sees and does in the admin app. Terms: see the
[glossary](README.md#glossary).

## Visits

- **ADM-1** The admin app marks a checkout awaiting payment (BIL-49) as such, shows the amount the Wallee terminal approved, and can list only those checkouts. — #812
- **ADM-15** The correction of a visit (BIL-21) offers *Freiwilligengruppe* and *Interne Nutzung* only on the account holder's line, each only while the account holder's account is in that type's Workspace group (ADM-11), and *Interne Nutzung* only while nobody else is on the visit (CHK-52), as the server requires (CHK-53); every other usage type is offered on every line, a volunteer's own included (unlike CHK-51). — ADR-0053

## Workspace groups

- **ADM-11** Every hour, and whenever an admin starts it, a sync sets for each account whether it is in the *Freiwilligengruppe* and whether it is in the *Interne Nutzung* group, by whether the account's e-mail address is in that Workspace group. — ADR-0053
- **ADM-12** No client, an admin's included, can change whether an account is in a Workspace group; that is changed in Google Workspace only and reaches the account with the next sync (ADM-11). — ADR-0053
- **ADM-13** The sync report lists, for each Workspace group, the addresses in it that match no account. — ADR-0053
- **ADM-14** A volunteer who is not a member is shown as a warning on the sync report and on their user page in the admin app; *Freiwilligengruppe* does not require a membership (CHK-51). — ADR-0053

## Material labels

- **ADM-2** An admin prints one material label from a catalog item's page, or every label in the cart of the *Etiketten* tab in one go, and sees each label's preview, as it will print, beforehand. — ADR-0033, #337, #490
- **ADM-3** A material label carries the item's code, its label name (else its display name), its label mass if it has one, and a QR code linking to the item in the checkout. — ADR-0026, #562, #593
- **ADM-8** For an item with more than one variant, both places that print a material label (ADM-2) offer the choice of which variant the label is for, in the cart on each catalog row before it is added, starting on the item's first variant. — #824
- **ADM-9** A material label for a variant other than the item's first also prints that variant's name, if it has one, after the mass, and its QR code opens the checkout with that variant preselected (CHK-48); the first variant's label stays the plain item label of ADM-3. — #824
- **ADM-10** The cart holds an item once per variant, and adding all matches adds only each item's first variant. — #824
- **ADM-4** The admin app prints a material label in one of two formats: on 18 mm tape, 72 mm long, or on 36 mm tape, 100 mm long. — #593, #824
- **ADM-7** Both places that print a material label (ADM-2) offer the choice of format, which in the cart applies to every label, and each opens on 18 mm × 72 mm whatever was picked before. — #824
- **ADM-5** A material label's length doesn't depend on its content: a name or a bottom line (the mass and any variant name) too long for it shrinks, and only text still too long at the smallest size lengthens the label rather than being cut off. — #593, #824
- **ADM-6** When the tape loaded in the printer isn't the one a label was made for, nothing prints and the admin is told why. — #337

## Retired

<!-- `- ADM-n — <PR that retired it>` -->
