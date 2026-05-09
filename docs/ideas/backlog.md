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
