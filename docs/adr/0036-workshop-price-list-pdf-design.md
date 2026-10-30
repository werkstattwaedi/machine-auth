# ADR-0036: Workshop price-list PDFs rendered in pdfkit from the design handoff

**Status:** Accepted

**Date:** 2026-07-17

## Context

The printable price lists ("Werkstatt-Preislisten") got a finalized design
handoff (Stand 14.07.2026): one A4 PDF per workshop, carrying the workshop's
Farbkonzept color (title highlight bar + header rule), Bitter/Roboto Slab
typography, a header QR code deep-linking into the checkout app, one table
per category, and CSS-style pagination rules (categories ≤ 12 rows stay
together, longer ones split with ≥ 3 rows on each side, repeated column
head, footer on every page).

The handoff is authored as plain HTML + CSS print semantics and suggests an
HTML→PDF pipeline (headless Chromium/Puppeteer) so the pagination rules come
for free. The repo's existing generator (`functions/src/price_list/`) draws
PDFs imperatively with pdfkit inside the `catalogCall` dispatcher.

Two structural questions had to be settled:

1. **Rendering engine** — adopt headless Chromium, or re-implement the
   design in pdfkit?
2. **Where the workshop + categories come from** — price lists were flat,
   hand-curated item-ID lists with no workshop identity or grouping.

## Decision

1. **Re-implement the design in pdfkit** (`build_price_list_pdf.ts`). The
   design's CSS-pixel geometry is transcribed 1:1 into points (1 px =
   0.75 pt); the pagination rules are hand-implemented, which is exact
   because every table row has a deterministic 24 pt height. Bitter
   (700/800) and Roboto Slab (400/500/600) static TTFs plus the OWW logo
   are vendored under `functions/assets/price_list/`.
2. **Keep curated `price_lists` docs; derive the rest from the catalog**
   (`derive_render_data.ts`, pure/unit-tested). Per item the path
   `[workshopLabel, ...category]` is built from the catalog doc's
   `workshops` and `category` fields; the page title is the last element of
   the longest common prefix of all paths (single category → its name, and
   its table heading is suppressed). Tables group by full category path,
   ordered by lowest code; the unit in `Preis CHF/<unit>` comes from
   `variants[0].pricingModel`. A list whose items don't share one workshop
   fails with `failed-precondition` (the design forbids mixing workshops in
   one PDF); the admin UI warns before that. The Farbkonzept colors +
   labels live in `@oww/shared` (`workshop.ts`) so functions and web use
   the same palette as the `--color-ws-*` CSS tokens.
3. The printed footer is the fixed design footer (Stand date +
   attribution + stamped `Seite n von N` when multi-page); the free-text
   `footer` field was dropped from the price-list doc/UI. Only the default
   (non-member) price is printed.

## Consequences

**Pros:**
- No new heavy dependency: Chromium in Cloud Functions would have forced
  the PDF path out of the shared `catalogCall` dispatcher (ADR-0028) into a
  dedicated ≥1 GiB function, slowed renders to seconds, and complicated CI.
- Deterministic output, testable with the existing pdf-to-img visual
  regression harness (snapshots checked in per fixture page).
- Lists stay hand-curated (subsets possible) and the QR deep link
  `/visit/add/list/{id}` keeps working unchanged.

**Cons:**
- Future design changes must be transcribed from CSS to pdfkit geometry by
  hand instead of copy-pasting the handoff CSS.
- Pagination edge cases are our code, not a browser print engine
  (mitigated: rules are unit-tested and rows have fixed height).
- Long cell text truncates with an ellipsis instead of wrapping (a wall
  list should not wrap rows anyway; the Mass column may extend into the
  price column's empty left half before truncating).
- The content hash includes the printed "Stand" date, so the first download
  after midnight regenerates and stores a new object even when prices are
  unchanged (at most one ~50 KB object per list per day, only when someone
  actually clicks download). Accepted: the footer date must match reality,
  and the storage cost is negligible; revisit with a lifecycle rule on
  `price-lists/` if it ever isn't.

**Tradeoffs:**
- *Headless Chromium (Puppeteer + @sparticuz/chromium)* was rejected for
  operational weight, despite near-1:1 CSS reuse from the handoff.
- *Auto-generating one list per workshop from the whole catalog* was
  rejected to keep the admin's ability to hand-pick what hangs on the wall;
  the single-workshop rule is enforced at generation time instead.

## Amendment 2026-10-30: several prices per item

The laser materials sell in cut formats next to their per-m² price, and a wall
list showing only `variants[0]` hid what a member actually buys. This supersedes
"the unit comes from `variants[0].pricingModel`", the single `Preis CHF/<unit>`
head and the product half of "long cell text truncates".

- **Every variant is printed**, one price column per way a section's items are
  sold, derived in `derive_render_data.ts`: named formats smallest first (mean
  price relative to the item's base, so a price change doesn't reorder them),
  per-unit prices last, one column per unit (a section mixing kg and Stk no
  longer prints both under the first item's unit). A row not sold in a column
  shows a dash.
- **Shrink, then cap.** Only sections with several prices fit Mass and prices to
  their content; single-price sections keep the design's fixed columns, so
  lists without variants only change in their two-line price head
  (`Preis CHF` / `pro m²`, from the proposal). The real catalog needs at most 4
  columns; 5 stays legible with wrapped headings. Beyond `MAX_PRICE_COLUMNS` (5)
  generation fails with `failed-precondition` naming the section: dropping a
  price silently would misinform the wall list, and a fixed limit of 3 (as in
  the proposal) would already have hidden A3.
- **Product names wrap to two lines** instead of truncating, because shrunken
  columns make them collide on real data. Row heights are measured up front, so
  the pagination math stays exact; the rules (≤ 12 rows together, ≥ 3 rows each
  side) are unchanged. Mass still truncates.
- "Zuschnitt" is dropped from format labels in the head; the column already sits
  under `Preis CHF` and the word costs the width the column is short of.
