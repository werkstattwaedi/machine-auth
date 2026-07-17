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
