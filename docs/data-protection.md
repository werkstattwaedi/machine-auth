# Data Protection — Operating Manual

How the Offene Werkstatt Wädenswil machine-auth system meets the Swiss
DSG: what personal data exists where, how long it lives, and how to serve
data-subject requests. Architecture rationale lives in
[ADR-0038](adr/0038-data-lifecycle-retention-dsar-erasure.md) (lifecycle)
and [ADR-0039](adr/0039-anonymized-statistics-bigquery.md) (statistics).

**Controller:** Verein Offene Werkstatt Wädenswil. DSAR contact: the
Vorstand via the official association email address.

## Processing register

The machine-readable source of truth is
[`functions/src/privacy/subject_data_map.ts`](../functions/src/privacy/subject_data_map.ts)
— per collection: PII fields, legal basis, retention, trim spec, and
erasure strategy. A CI test forces every audited collection to carry an
entry, so this register cannot silently go stale. Summary (hand-synced;
the map wins on conflict):

| Data | Where | Legal basis | Retention |
|---|---|---|---|
| Account (name, email, address) | `users`, Firebase Auth | Contract | Until erasure |
| NFC badge (tag UID) | `tokens`, `items.tokenId` | Contract | Until erasure |
| Visits incl. guests' names/emails | `checkouts` (+ `persons[]`) | Contract | 3 years |
| Machine usage | `usage_machine` | Contract | 3 years |
| Invoices | `bills` | Contract | 3 years |
| Invoice PDFs | Storage `invoices/`, then archive bucket | OR Art. 958f | 10 years (escrowed) |
| Badge auth records | `authentications` | Contract | 3 years (in-progress: 5 min TTL) |
| Login codes | `loginCodes` | Contract | 5 min TTL |
| Membership invites | `memberships/invites` | Consent | 30 days TTL |
| Audit copies | `audit_log` | Legitimate interest | 3 years |
| Ops/error log | `operations_log` | Legitimate interest | 3 years |
| Machine issue reports | `machine_reports` | Legitimate interest | Until erasure (redacted) |
| Pseudonymized statistics | BigQuery `stats` | DSG Art. 31(2)(e) | Indefinite (salt-destructible) |

## Processors

- **Google Cloud / Firebase** (europe-west6, Zürich): Firestore, Auth,
  Storage, Functions, BigQuery. Cloud Logging retains function logs
  ~30 days; phone-auth SMS route through Google's SMS providers.
- **Resend**: transactional email (invoices, login codes, invites).
  Retention per Resend; manual deletion on request via their dashboard.

## DSAR: access request (Art. 25)

Expectation: answer within 30 days. Procedure:

```bash
# Emulator dry-run first if unsure; then production:
FIREBASE_PROJECT_ID=oww-maco npx tsx scripts/privacy-cli.ts report \
  --email person@example.com --prod > report.json
```

The JSON contains the full subject graph (auth account, user doc, badges,
visits incl. items, appearances in other people's checkouts — the
subject's own entry only —, invoices + PDF list, machine usage,
memberships, invites, login codes, machine reports, audit-log counts), the
statistics disclosure, this processor list, and the residuals. Manual
follow-ups NOT covered by the tool: Resend email history, Cloud Logging
(30-day window — usually already expired).

## DSAR: erasure request (Art. 32)

```bash
# 1. Preview — lists every action, writes nothing:
npx tsx scripts/privacy-cli.ts erase --email person@example.com --dry-run --prod

# 2. If blocked (open checkout, unpaid bill, active owned membership):
#    settle via the admin UI first — the CLI prints the exact paths.

# 3. Live run (confirm-email is the typo guard):
npx tsx scripts/privacy-cli.ts erase --email person@example.com \
  --confirm-email person@example.com --prod
```

The engine flushes unexported stats first, deletes the subject graph,
moves invoice PDFs to the escrow archive, redacts the person out of other
people's checkouts, deletes the Auth account, and purges the audit log —
then the CLI waits ~60s and repeats the purge until the async audit
triggers stop producing entries. The receipt (`erasures/{subjectId}`,
PII-free) is the proof of erasure; keep it.

Anonymous walk-ins (no account): same command with `--email` — only their
`persons[]` entries, invites, and login codes exist, and only those are
redacted/deleted.

Tell the requester about the residuals (below) — in particular that
pseudonymized statistics are retained under DSG Art. 31(2)(e) and that
invoice PDFs remain in a locked archive for the legal 10 years.

## Ops calendar

- **January (yearly): retention trim.**
  ```bash
  npx tsx scripts/privacy-cli.ts trim --dry-run --prod   # review counts!
  npx tsx scripts/privacy-cli.ts trim --prod
  ```
  Deletes checkouts/bills/usage/authentications/audit/ops-log older than
  Jan 1 three years back; moves trimmed bills' PDFs to the archive. The
  dry-run review is mandatory — first prod run doubly so.
- **After schema changes to the stats tables:** re-run
  `scripts/setup-bigquery.ts` (idempotent).

## Residuals & accepted risks

- **Backups / PITR**: Firestore point-in-time recovery retains deleted
  docs up to 7 days after an erasure.
- **Escrowed PDFs**: 10-year archive readable only via break-glass IAM
  (bucket audit-logged); expires via `daysSinceCustomTime` lifecycle.
- **Free text**: `operations_log.message` (error payloads can embed
  emails) and `machine_reports.message` (self-disclosed details) persist
  until the 3-year trim; redact manually on request.
- **Dangling identifiers**: paths/UIDs in receipts and old references
  resolve to nothing after erasure (`resolveRef` falls back to the raw
  id).
- **Stats divergence**: admin-SDK edits to already-exported docs never
  reach BigQuery (export-once, ADR-0039).
- **Outside our systems**: the Verein's bank records keep (date, amount,
  payer) for 10 years — the same join the PDF escrow defeats internally.
- **Re-identification**: BigQuery rows are pseudonymous, not anonymous; a
  break-glass archive read plus BQ access could re-link. Mitigations:
  write-only SA, audit logging, hour truncation, salt destruction as the
  kill switch.
