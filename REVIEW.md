# Catalog redesign — code review (PR A → animation follow-up)

Findings from a per-commit code-reviewer pass over the 12 commits between
`3d7147b` (PR A) and `9f5f021` (animation follow-up).

Severity legend:
- **B = blocker** — wrong behavior, accessibility regression, or
  type-safety hole that defeats a project convention.
- **S = suggestion** — improvement worth doing in this branch.
- **N = nit** — small cleanup, optional.

Where I've verified the finding still applies to current `HEAD` I've
flagged it `✅ confirmed`. One finding was obsoleted by a later commit
and is annotated as such.

---

## PR A — schema with variants + category + config-driven refs (`3d7147b`)

**A1 (B) ✅** `web/apps/checkout/src/routes/_authenticated/membership/index.tsx:109`
— `configRef(db, "catalog-references") as unknown as DocumentReference<CatalogReferencesDoc>`
double-casts through `unknown`. The fix is a dedicated
`catalogReferencesRef(db)` builder in `firestore-helpers.ts` (matching
every other doc type per ADR-0023). The double-cast defeats the typed
access contract and sets a bad precedent.

**A2 (B) ✅** `web/apps/checkout/src/routes/_authenticated/membership/index.tsx:118`
— `v.unitPrice.default` is read unconditionally. A signed-in member
renewing membership sees the full (non-discounted) price in the UI
while the server still charges the member price. Apply
`priceForTier(v.unitPrice, level)` using the existing helper from
`web/modules/lib/pricing.ts`.

**A3 (S)** `functions/src/membership/shared.ts:73` — `_database: Firestore`
parameter is dead after the catalog read was removed; underscore signals
"intentionally unused" but the parameter could just be removed at the
two call-sites.

**A4 (S)** `functions/src/types/firestore_entities.ts` — `priceForTier`
is duplicated from `web/modules/lib/pricing.ts`. Acceptable given the
functions/web package boundary, but worth noting for the future
mono-repo refactor so the two copies don't drift.

**A5 (S)** `web/modules/test/fixtures.ts:17–28` —
`variantPriceFromShorthand` normalises legacy `{ none: 50 }` shorthand.
Project policy is to change call-sites instead of papering over. There
are a bounded number of fixtures; migrating them removes the
`none`/`default` duality from test code.

---

## PR B — new seed (Holz from xlsx, Makerspace variants, machines) (`830f966`)

**B1 (S) ✅** `scripts/seed-emulator.ts:471` — comment says
"Sperrholz-Platten block" but the range starts at code `3080` (Rohspan
16mm — `MDF- und Spanplatten`), not Sperrholz proper. Sample checkout
silently uses a Rohspan entry while labelling it `"Sperrholz
(Beispiel)"`. Bump the lower bound to `3082` (Birke BB) or update the
comment + label.

**B2 (S)** `scripts/build-catalog-from-xlsx.ts:215` — sheet path is
hard-wired to `xl/worksheets/sheet2.xml`. xlsx sheet numbering is
insertion-order, not tab-position; if Mike inserts a sheet ahead of
"Holz PL" the parser silently reads the wrong sheet. Resolve via
`xl/workbook.xml` + `xl/_rels/workbook.xml.rels` to map name → path,
and throw if "Holz PL" is missing.

**B3 (S) ✅** `scripts/seed-data/catalog/makerspace.json` (and
`holz.json`) — no variant carries a `member` price. Schema makes
`member` optional and absent = no discount, which is correct semantics.
But this means materials have no member discount while `machines.json`
does. Intentional (xlsx has no member column yet) or oversight? Worth a
sticky TODO either way.

**B4 (N)** `scripts/build-catalog-from-xlsx.ts:175` —
`pricingModelFromHeader` matches `"Preis/m2"` (ASCII 2) but the xlsx
header would natively render `"Preis/m²"` (U+00B2). Today's seeds work
because the xlsx uses ASCII; defensive alias is one line.

---

## PR C — material picker UI: chips + variant selector (`d677dc4`)

**C1 (B) — OBSOLETE** Render-phase `setState` from `lastScope.current
!== scope` reset. This was tied to the workshop/Alle toggle which was
removed in `ef0902b`. No action needed.

**C2 (B) ✅** `web/apps/checkout/src/components/usage/material-picker.tsx:295`
— `key={value}` inside the chip row map can collide if two depths use
the same category label. The outer `<React.Fragment key={row.level}>`
prevents an actual DOM collision but React still warns. Fix:
`key={`${row.level}:${value}`}`.

**C3 (B) ✅** `material-picker.tsx:580` (variant chooser) — plain
`<button role="radio">` inside `<div role="radiogroup">` is valid HTML
but the keyboard contract is broken: ARIA radiogroup requires Arrow-key
navigation between radios, with Tab moving focus *out* of the group.
As shipped, keyboard users must Tab through every variant button. Use
Radix `RadioGroup` (already in the project via shadcn) or add
`tabIndex={selected ? 0 : -1}` + an `onKeyDown` handler.

**C4 (S) ✅** `material-picker.tsx:282` — `aria-label="Kategorien"` on a
plain `<div>` is silently dropped by screen readers (no implicit role).
Add `role="group"`.

**C5 (S)** Variant state in `PickerRowBody` does not reset when the
*same* row is closed and re-opened. NOTE: the animation follow-up
(`9f5f021`) accidentally fixed this by keying on `isExpanded`, but in
doing so introduced FU2 below. See FU2.

**C6 (S)** Tests don't cover: empty `catalogItems`, items with
`variants: []`. The empty-state path renders the "Keine Treffer"
message; a zero-variant item should fall through to `unitPrice = 0`
without crashing.

**C7 (N)** `web/modules/lib/categories.ts:60` — `filterByCategoryPrefix`
copies the array on empty prefix. Runs inside `useMemo`; tiny but
unnecessary.

---

## PR D — wire CognitoForms importer to pinned IDs (`a38f3c8`)

**D1 (S)** `functions/src/import/cognitoforms/run_import.ts:282` — no
runtime guard for an unrecognised `catalogKey`. Type-safe at compile
time, but `m.catalogKey` originates from CognitoForms JSON via
`mappers.ts`; an unknown form schema would produce a `catalog/undefined`
ref that Firestore accepts silently. Either tighten `mappers.ts` to
exhaustively narrow, or assert at the call-site.

**D2 (N)** `functions/test/integration/cognitoforms-import.test.ts` —
test doesn't seed the 12 catalog docs because the importer only writes
refs without reading them. Worth a one-line comment locking the
invariant in place.

**D3 (verified)** No ID drift between
`scripts/seed-data/catalog-ids.ts` and
`functions/src/import/cognitoforms/catalog_map.ts`; all 12 IDs resolve
to existing seed entries.

---

## Follow-up commits (`ef0902b` → `9f5f021`)

**FU1 (B) ✅** `scripts/seed-data/catalog/makerspace.json` — all three
resins have `default: 250` and no `member` price. The original `SLA
Druck` had `default: 250` *and* `member: 200`; the member discount is
now silently gone for every resin. Either the uniform pricing is real
(needs a comment) or this is a placeholder going to prod. Re-add
member prices and differentiate the resins, or add a `// TODO`.

**FU2 (B) ✅** `material-picker.tsx:502` — `key={isExpanded ?
"${id}:open" : "${id}:closed"}` causes `PickerRowBody` to remount when
the row begins closing. The Collapsible content stays mounted for the
close animation, but the body inside it is already gone — the user
sees a blank panel during the 140ms close. Use `key={catalog.id}` and
rely on the existing `key={variant?.id}` for variant-change resets.

**FU3 (S) ✅** `web/modules/index.css:163` — `collapsible-down/up`
keyframes do not respect `prefers-reduced-motion`. Tailwind's
`animate-in` utilities have `motion-safe:` variants but the custom
keyframes applied via `data-[state=open]:animate-[…]` bypass them. Wrap
the keyframes (or just the animation duration) in a `@media
(prefers-reduced-motion: no-preference)` query.

**FU4 (S) ✅** `scripts/apply-catalog-tweaks.ts` — one-shot script
whose output is already committed to the JSON files. Either delete it
now or roll its transformations into `build-catalog-from-xlsx.ts` so
re-running the parser produces the same shape.

---

## Recommended order

1. Land FU1, FU2, A1, A2, C2, C3 — these are the genuine blockers.
2. B1, C4, FU3 — quick accessibility/comment fixes.
3. A3, A5, B3, C5, C6, D1, FU4 — small follow-ups, can batch.
4. A4, B2, B4, C7, D2 — defer, document as known limitations or
   address opportunistically.
