# Catalog

The catalog of what the workshop sells, and the price lists printed from it.
Terms: see the [glossary](README.md#glossary).

## Price lists

- **CAT-1** A price list holds the catalog items an admin picked for it by hand, and only an admin can change it or generate its PDF. — ADR-0036
- **CAT-2** A price list covers one workshop: when its items share none, the PDF can't be generated, and the admin app says so before anyone tries. — ADR-0036
- **CAT-3** A price list has one section per category of its items. — ADR-0036
- **CAT-4** A price list prints non-member prices only, never a member price. — ADR-0036
- **CAT-5** Each item on a price list shows one price, that of its first variant, under a column naming the price's unit, if it has one. — ADR-0036
- **CAT-6** A product name or mass too long for its column is cut off, so every item takes one line. — ADR-0036

## Retired

<!-- `- CAT-n — <PR that retired it>` -->
