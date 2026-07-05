# ADR-0032: Workflow-first admin information architecture

**Status:** Accepted

**Date:** 2026-07-05

## Context

The admin app's navigation mirrored the database: one nav entry per
Firestore collection (Benutzer, Mitgliedschaften, Maschinen, Berechtigungen,
Terminals, Sitzungen, Checkouts, Materialien, Preislisten, Audit Log), each
rendering a raw table. Admin tasks — "a member walks up with a question",
"a machine is broken", "book the bank statement" — required hopping between
tables and mentally joining them.

A design exploration (Claude-design wireframes, July 2026) converged on a
task-first structure: the sidebar is *where an admin starts a task*, and
supporting entities live inside the workspace they serve.

## Decision

### Four workflow entry points + shared ledgers

Primary nav: **Personen** (`/users`), **Maschinen** (`/machines`),
**Inventar** (`/materials`), **Rechnungen** (`/invoices`).
Secondary nav: **Besuche** (`/visits`), **Nutzungen** (`/usages`),
**Audit-Log** (`/audit`).

Supporting entities have no top-level surface anymore:

- **Mitgliedschaften** are managed inline on the person page
  (create / verlängern / kündigen / family roster / invites).
- **Berechtigungen** are granted/revoked on the person page and required on
  the machine settings tab. `/permissions` (create/delete of the permission
  entities themselves) stays routable but out of the nav — rare config work.
- **Terminals** page deleted; MaCo assignment lives in machine settings.
- **Preislisten** and label printing are tabs of the Inventar workspace.

### Deep-linkable everything

- Person/machine pages use `?tab=` search params for their tabs.
- The shared ledgers accept `?user=` / `?machine=` search params, rendered
  as removable filter chips. Overview cards on person/machine pages
  navigate *out* into these pre-filtered ledgers rather than duplicating
  tables in tabs ("read-only overview → focused list with bulk actions").

### Query pattern (no new composite indexes)

Ledger lists subscribe broad (`orderBy … desc, limit ≤300`) and filter
client-side; person/machine-scoped views use equality-only queries
(zig-zag merge — indexless) with client-side sorting. Components that vary
query constraints at runtime are keyed by the filter value because
`useCollection` only re-subscribes on collection-path changes.

### New data surface

- `machine.blocked { kind: problem|maintenance, note, byName, at } | null`
  — admin Sperren/Freigeben; terminals should deny sessions while set
  (firmware follow-up).
- `machine_reports` got a concrete schema (rules pre-existed): member-filed
  Meldungen triaged on the machine page. Member-side filing UI is a
  follow-up; the collection already allows public create.
- `price_lists.generatedAt` — stamped after PDF generation; compared with
  catalog `modifiedAt` to flag stale Aushänge.
- `adminMarkBillsPaid` callable (billingCall) — the only payment-booking
  write path; bills stay client-write-denied. Used by manual bulk mark-paid
  and the statement import (client-side parse, SCOR reference matching per
  ISO 11649). Two upload formats: camt.053 XML (booked as `ebanking`) and
  the RaiseNow TWINT CSV export, matched by header text on its
  `Kreditor-Referenz` / `Status` / `Betrag` columns (booked as `twint`;
  only `succeeded` rows count).

## Consequences

- Admin flows (question at the counter, machine defect, statement booking,
  price-list refresh) each start from one nav entry and stay in one
  workspace; the raw-table pages are gone.
- Bills can now be marked paid from the UI; reconciliation covers bank
  (camt.053) and TWINT (RaiseNow CSV). A "Zahlung ausstehend" state (needs
  persistent per-channel reconciliation coverage) is a deliberate follow-up.
- Overdue is derived (created + 30 d, no stored due date) — mirrors the
  invoice PDF's payment terms.
- The e2e suite seeds a full workflow dataset (machines, reports, visits,
  usage, bills in all states, family membership, stale price list) with
  fixed dates so screenshot baselines stay stable.
