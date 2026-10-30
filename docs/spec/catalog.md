# Catalog

The catalog of what the workshop sells, and the price lists printed from it.
Terms: see the [glossary](README.md#glossary).

## Price lists

- **CAT-1** A price list holds the catalog items an admin picked for it by hand, and only an admin can change it or generate its PDF. — ADR-0036
- **CAT-2** A price list covers one workshop: when its items share none, the PDF can't be generated, and the admin app says so before anyone tries. — ADR-0036
- **CAT-3** A price list has one section per category of its items. — ADR-0036
- **CAT-4** A price list prints non-member prices only, never a member price. — ADR-0036
- **CAT-5** Each item on a price list shows a price for every one of its variants. — ADR-0036 (amended)
- **CAT-7** A section has one price column per way its items are sold, each naming its format or, if it has one, its unit: named formats smallest first, then one column per distinct unit; an item not sold in a column shows a dash there. — ADR-0036 (amended)
- **CAT-8** When a section would need more than 5 price columns, generating the PDF fails with an error naming the section instead of leaving a price out. — ADR-0036 (amended)
- **CAT-6** A product name too long for its column wraps to at most two lines and is cut off only beyond that; a mass too long for its column is cut off. — ADR-0036 (amended)

## Retired

<!-- `- CAT-n — <PR that retired it>` -->
