// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * BigQuery statistics dataset — table + view definitions (ADR-0039).
 *
 * Single source of truth consumed by the export job's row builders, the
 * idempotent `scripts/setup-bigquery.ts` provisioner, and the integration
 * tests. Deliberately dependency-free (no firebase imports) so the setup
 * script can import it from the `scripts/` package.
 *
 * All tables are append-only with `doc_id` + `exported_at`; the `*_v` view
 * per table dedups to the latest row per `doc_id`, which makes re-exports
 * and crash-duplicates harmless (no MERGE, no streaming-buffer DML).
 * Analysts query only the views.
 *
 * Privacy invariants:
 * - No names, emails, addresses, tag UIDs, referenceNumbers, or storagePaths.
 * - `subject_key` is the HMAC pseudonym from `privacy/subject_key.ts`.
 * - Event timestamps are truncated to the hour (re-identification hardening);
 *   dates are Zurich-local.
 */

export interface StatsField {
  name: string;
  type: "STRING" | "DATE" | "TIMESTAMP" | "INT64" | "NUMERIC" | "BOOL";
  mode?: "NULLABLE" | "REQUIRED" | "REPEATED";
  description?: string;
}

export interface StatsTableDef {
  name: string;
  description: string;
  /** DATE column used for time partitioning. */
  partitionField: string;
  clusterFields: string[];
  fields: StatsField[];
}

const BOOKKEEPING: StatsField[] = [
  { name: "doc_id", type: "STRING", mode: "REQUIRED", description: "Source doc identity; dedup key of the *_v view" },
  { name: "exported_at", type: "TIMESTAMP", mode: "REQUIRED", description: "Export run timestamp; latest wins in the *_v view" },
];

export const STATS_TABLES: StatsTableDef[] = [
  {
    name: "visits",
    description: "One row per closed checkout (visit).",
    partitionField: "visit_date",
    clusterFields: ["usage_type", "is_member"],
    fields: [
      ...BOOKKEEPING,
      { name: "visit_date", type: "DATE", mode: "REQUIRED", description: "Zurich-local date of closedAt" },
      { name: "closed_at", type: "TIMESTAMP", description: "Hour-truncated" },
      { name: "subject_key", type: "STRING", description: "HMAC pseudonym; NULL when no account/principal" },
      { name: "is_registered", type: "BOOL", description: "Checkout billed to a users doc" },
      { name: "usage_type", type: "STRING" },
      { name: "workshops", type: "STRING", mode: "REPEATED", description: "Distinct workshops across items (fallback workshopsVisited)" },
      { name: "person_count", type: "INT64" },
      { name: "user_types", type: "STRING", mode: "REPEATED", description: "persons[].userType, one entry per person" },
      { name: "is_member", type: "BOOL", description: "Active membership at export time (T+1 approximation)" },
      { name: "total_price", type: "NUMERIC" },
      { name: "entry_fees", type: "NUMERIC" },
      { name: "machine_cost", type: "NUMERIC" },
      { name: "material_cost", type: "NUMERIC" },
      { name: "tip", type: "NUMERIC" },
      { name: "discount_amount", type: "NUMERIC" },
    ],
  },
  {
    name: "visit_items",
    description: "One row per checkout line item.",
    partitionField: "visit_date",
    clusterFields: ["workshop", "catalog_id"],
    fields: [
      ...BOOKKEEPING,
      { name: "checkout_id", type: "STRING", mode: "REQUIRED" },
      { name: "visit_date", type: "DATE", mode: "REQUIRED" },
      { name: "subject_key", type: "STRING" },
      { name: "workshop", type: "STRING" },
      { name: "item_type", type: "STRING", description: "material | machine (absent source field ⇒ material)" },
      { name: "catalog_id", type: "STRING", description: "catalog doc id; NULL for free-form items" },
      { name: "quantity", type: "NUMERIC" },
      { name: "unit_price", type: "NUMERIC" },
      { name: "total_price", type: "NUMERIC" },
      { name: "origin", type: "STRING", description: "nfc | manual | qr" },
    ],
  },
  {
    name: "machine_usage",
    description: "One row per completed usage_machine record.",
    partitionField: "usage_date",
    clusterFields: ["machine"],
    fields: [
      ...BOOKKEEPING,
      { name: "usage_date", type: "DATE", mode: "REQUIRED", description: "Zurich-local date of endTime" },
      { name: "subject_key", type: "STRING" },
      { name: "machine", type: "STRING", description: "machine doc id" },
      { name: "workshop", type: "STRING" },
      { name: "start_time", type: "TIMESTAMP", description: "Hour-truncated" },
      { name: "end_time", type: "TIMESTAMP", description: "Hour-truncated" },
      { name: "active_seconds", type: "INT64" },
      { name: "billable_seconds", type: "INT64" },
    ],
  },
  {
    name: "bills",
    description:
      "One row per PAID bill. Deliberately excludes referenceNumber and storagePath (re-link vectors, ADR-0039).",
    partitionField: "paid_date",
    clusterFields: ["paid_via"],
    fields: [
      ...BOOKKEEPING,
      { name: "paid_date", type: "DATE", mode: "REQUIRED", description: "Zurich-local date of paidAt" },
      { name: "paid_at", type: "TIMESTAMP" },
      { name: "subject_key", type: "STRING" },
      { name: "amount", type: "NUMERIC" },
      { name: "paid_via", type: "STRING", description: "twint | ebanking | cash | free" },
      { name: "kind", type: "STRING", description: "invoice | beleg (absent ⇒ invoice)" },
      { name: "source", type: "STRING", description: "checkout | membership-renewal (absent ⇒ checkout)" },
    ],
  },
  {
    name: "membership_snapshots",
    description: "Active memberships snapshotted once per month.",
    partitionField: "snapshot_date",
    clusterFields: ["type"],
    fields: [
      ...BOOKKEEPING,
      { name: "snapshot_date", type: "DATE", mode: "REQUIRED", description: "First day of the snapshotted Zurich month" },
      { name: "type", type: "STRING", description: "single | family" },
      { name: "member_count", type: "INT64" },
      { name: "owner_subject_key", type: "STRING" },
      { name: "valid_until", type: "DATE" },
    ],
  },
];

/** Name of the dedup view for a table. */
export function viewName(tableName: string): string {
  return `${tableName}_v`;
}

/**
 * Standard-SQL body of the dedup view: latest exported row per doc_id.
 * Dataset-qualified so the view works regardless of default project.
 */
export function dedupViewQuery(datasetId: string, tableName: string): string {
  return (
    `SELECT * EXCEPT (row_rank) FROM (\n` +
    `  SELECT *, ROW_NUMBER() OVER (PARTITION BY doc_id ORDER BY exported_at DESC) AS row_rank\n` +
    `  FROM \`${datasetId}.${tableName}\`\n` +
    `) WHERE row_rank = 1`
  );
}
