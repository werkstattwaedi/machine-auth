# Ideas & Future Work

A lightweight backlog for features and improvements that aren't yet committed work.

## Format

Each idea should have:
- **Title** - Brief description
- **Status** - `💡 Idea` | `🔬 Exploring` | `📋 Planned` | `✅ Done` | `❌ Rejected`
- **Context** - Why might we want this?
- **Notes** - Any relevant thoughts, research, or links

---

## Active Ideas

### Session Broadcasting (Firmware)
**Status:** 💡 Idea

**Context:** Currently, every terminal queries the cloud when a user badges in. To reduce Firebase operations, we could broadcast active sessions to all terminals via Particle Pub/Sub.

**Notes:**
- Related to Firebase 100K operations/month budget constraint
- Each terminal maintains local session cache
- When session created, broadcast to all terminals
- Reduces cloud queries for multi-machine workflows
- Need to handle cache invalidation when session ends

**Related:** See CLAUDE.md section on Firebase Operations Budget

---

### PDF invoice — restructure to type-of-cost grouping
**Status:** 💡 Idea

**Context:** The Bezahlen redesign (May 2026) restructured the web Step 3
("Check Out") around three type-of-cost rows — Nutzungsgebühren,
Maschinen-/Werkzeugnutzung, Materialbezug — instead of grouping by
workshop. The PDF (`functions/src/invoice/build_invoice_pdf.ts`) still
groups items by workshop, which now diverges from what the user saw on
screen right before the bill was generated.

**Notes:**
- File: `functions/src/invoice/build_invoice_pdf.ts::renderCheckoutSection`
- Today the PDF iterates `data.workshops` per checkout and renders one
  table per workshop. The new mental model is: one table for entry
  fees (already separate), one for machine-time NFC items
  (`origin === "nfc"`), one for material items.
- Visit-date header should stay; workshop label can become a
  *secondary* tag on each row instead of the section heading.
- Tests to update: `functions/test/unit/build_invoice_pdf.test.ts` and
  the snapshots in
  `functions/test/integration/{create-bill-trigger,bill-processing-trigger}.test.ts`.

---

### Port-block broker: offset the Playwright e2e vite port
**Status:** 📋 Planned — tracked in [#485](https://github.com/werkstattwaedi/machine-auth/issues/485)

**Context:** Concurrent e2e runs (parallel CI, multiple agent worktrees)
get distinct emulator port blocks from `scripts/port-block.ts`, but the
Playwright webServer port is hardcoded to `5188` in
`web/apps/checkout/playwright.config.ts` (`E2E_PORTS.vite`). Two
simultaneous `test:web:e2e` runs therefore still collide: the second
fails with "https://localhost:5188 is already used". Observed 2026-06-12
when a snapshot regeneration in one worktree raced a workqueue e2e run
in a sibling worktree.

**Notes:**
- Not a one-line fix: the operations config pins the login-code origin
  allowlist to `https://localhost:5188,https://localhost:5189`
  (`scripts/generate-env.ts::loginAllowedOrigins`), and
  `web.checkoutDomain` is `localhost:5188` in emulator mode — an offset
  vite port would break callable origin checks and QR/domain-derived
  URLs unless those are derived from the block too.
- Sketch: have the broker export `EMULATOR_VITE_PORT` (base 5188 +
  block offset) like the other ports, read it in `E2E_PORTS.vite`, and
  make `generate-env.ts` emit the allowlist/domain for all five blocks
  (or template them from `PORT_BLOCK`).
- Until then: a colliding run should treat "port in use" like the
  broker's EX_TEMPFAIL — wait/retry rather than fail the suite.
- See `docs/port-blocks.md` for the broker design.

---

### Cron'd yearly retention trim
**Status:** 💡 Idea

**Context:** ADR-0038 keeps the yearly trim manual (privacy-cli, dry-run
reviewed) because it is destructive and annual. If the January ops-calendar
entry gets chronically forgotten, convert `privacyTrim` to an onSchedule
job — the engine already supports it; only the trigger and a notification
path (so a human still sees the counts) are missing.

---

### Alert on a stalled stats-export watermark
**Status:** 💡 Idea

**Context:** On 2026-08-28 `dailyStatsExport` failed on a single BigQuery row
and, because the watermark only advances after a successful insert, every
following nightly run failed identically. Nothing noticed: the run does emit an
ERROR (so the `Cloud Functions error logs` policy fires), but that policy
auto-closes after 24h and a repeating nightly failure looks like one recurring
alert rather than "statistics have been frozen for N days". The specific row
shape is fixed, but the *stuck* mode is generic — any future single-row
rejection wedges the export the same way.

**Notes:**
- Cheap version: a scheduled check that reads `export_state/*` and warns when
  any stream's `updatedAt` is older than ~36h. Catches the stall regardless of
  what caused it, including a silent one.
- Streams run sequentially in `runStatsExport`, so a failure in the first
  stream (`visits`) also starves `machine_usage`, `bills` and
  `membership_snapshots` — the check should look at every stream, not just one.
- Worth deciding at the same time whether a stream failure should abort the
  whole run or let the remaining streams proceed. Aborting is the current
  (deliberate) fail-fast; the cost is that one bad row freezes all four.

**Related:** ADR-0039, `functions/src/stats/export_job.ts`, the
`Cloud Functions error logs` alert policy and `dailyLogDigest`
(`functions/src/util/log_digest.ts`)

---

### Session Debug Viewer (Admin UI)
**Status:** 📋 Planned

**Context:** Admin UI has placeholder for sessions viewer. Need to implement for debugging and user support.

**Features:**
- View all sessions (active and historical)
- Filter by user, machine, date range
- View session details (usage records, timestamps)
- Manually close/invalidate sessions

---

### Bill corrections v2 — paid bills, credit notes, refunds
**Status:** 💡 Idea

**Context:** ADR-0042 corrects *unpaid* bills only; the callable rejects a
paid bill (or a Beleg whose Sammelrechnung is paid) with a German message
pointing here. Fixing a paid bill needs a credit-note / refund concept:
the payment stays booked, a negative document or a refund record offsets
it, and the bank reconciliation must accept a payment on a cancelled bill
(the import already buckets those as "Zahlung auf stornierte Rechnung").

**Notes:** Keep the base×10+digit numbering — a credit note could be a
revision with a negative amount, but the QR slip must then be suppressed.

### Correction editor — catalog picker
**Status:** 💡 Idea

**Context:** The admin correction editor (ADR-0042) only edits existing
lines and adds free-form lines. A catalog picker (same one the checkout
wizard uses) would let admins add priced catalog items with variants and
member pricing instead of typing description + price by hand.

### Cancelled PDFs — "STORNIERT" banner
**Status:** 💡 Idea

**Context:** Rejected for v1 because it overwrites the as-sent document.
Alternative: render a *second* PDF (`invoices/{id}-storniert.pdf`) with the
banner and offer it in the admin UI, keeping the original untouched.

### Bills with permanently deleted checkouts (2026-09 cleanup incident)
**Status:** 💡 Idea

**Context:** Until 2026-09-15 `cleanupAbandonedCheckouts` treated kiosk `tag:` sessions as anonymous visitors and deleted their checkouts seven days after the visit, closed and billed ones included. 25 checkouts referenced by prod bills `BL-4200000`…`RE-4200042` (bills created 2026-07-21 … 2026-09-05) are gone beyond the PITR/backup window; the bill docs and PDFs survive, so the money trail is intact, but the admin "Besuch …" links on those bills dead-end and `correctCheckouts` refuses them with "Besuch … nicht gefunden".

**Notes:**
- The BigQuery `stats.visits` / `visit_items` rows (pseudonymized) still hold the item lines and amounts of every lost visit, and each Beleg PDF has the full line items — enough to rebuild a checkout by hand if one of these bills ever needs a correction.
- The bill detail page could render a checkout ref that no longer resolves as "Besuch gelöscht" instead of a link — cheap, and the only place an admin would notice.
- Only bills before 2026-09-15 are affected; the job now refuses to delete anything closed, billed or user-owned.

### Member import — a changed e-mail creates a second person
**Status:** 💡 Idea

**Context:** `scripts/import-members.ts` matches rows to existing accounts by e-mail only (Auth + `users.email`). A member whose address changed between two exports of the club's member list is not recognised and is imported again as a new person — a second users doc and Auth account, with the membership attached to the new one. ADR-0043 makes the e-mail the canonical login identity and stops a *login* from splitting a member, but the import still can.

**Notes:**
- Needs a stable key in the export (member number) stored on the users doc, or a fuzzy "same name + address" pre-check that stops the row for a human.
- A merge tool (move tokens, memberships, checkouts, bills from uid B to uid A, then erase B) would also resolve the duplicates `privacy-cli audit-identity` can only report.
- Until then: before an import, change the e-mail of known movers in the admin profile tab first (`updateUserEmail` moves Auth and the doc together), so the import sees the account as existing.

## Template

Copy this for new ideas:

```markdown
### [Idea Title]
**Status:** 💡 Idea

**Context:** Why might we want this?

**Notes:** Any thoughts, research, or links
```
