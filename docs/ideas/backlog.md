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

### Session Debug Viewer (Admin UI)
**Status:** 📋 Planned

**Context:** Admin UI has placeholder for sessions viewer. Need to implement for debugging and user support.

**Features:**
- View all sessions (active and historical)
- Filter by user, machine, date range
- View session details (usage records, timestamps)
- Manually close/invalidate sessions

---

## Template

Copy this for new ideas:

```markdown
### [Idea Title]
**Status:** 💡 Idea

**Context:** Why might we want this?

**Notes:** Any thoughts, research, or links
```
