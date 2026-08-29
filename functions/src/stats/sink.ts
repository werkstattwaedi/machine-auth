// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * StatsSink — the seam between the export pipeline and BigQuery (ADR-0039).
 *
 * There is no BigQuery emulator, so all export logic is exercised through
 * this interface: tests use InMemorySink, `backfill-stats.ts --dry-run` uses
 * CountingSink, and production uses the real BigQuery streaming insert.
 */

import * as logger from "firebase-functions/logger";
import type { StatsRow } from "./row_builders";
import { STATS_TABLES } from "./schema";

export interface StatsSink {
  /** Insert rows into the named table. Must throw on failure (the caller
   *  only advances the export watermark on success). */
  insertRows(table: string, rows: StatsRow[]): Promise<void>;
}

/** Collects rows per table; the assertion surface for integration tests. */
export class InMemorySink implements StatsSink {
  readonly rows = new Map<string, StatsRow[]>();

  async insertRows(table: string, rows: StatsRow[]): Promise<void> {
    if (rows.length === 0) return;
    const existing = this.rows.get(table) ?? [];
    this.rows.set(table, existing.concat(rows));
  }

  tableRows(table: string): StatsRow[] {
    return this.rows.get(table) ?? [];
  }
}

/**
 * BigQuery NUMERIC stores at most 9 fractional digits, but a Firestore double
 * routinely carries 17: an `area` item measured 107 cm × 24 cm is stored as
 * `1.07 * 0.24 = 0.25680000000000003`. `insertAll` defaults to
 * `skipInvalidRows: false`, so ONE such row fails the entire request — which
 * is exactly how a single plywood cut wedged the daily export on 2026-08-28
 * (the watermark never advances, so it re-fails every night).
 *
 * Rounding at this scale is far below anything the numbers mean — money is
 * kept at two decimals throughout, and physical quantities are already
 * rounded to six at the write path — so it only ever removes noise. It
 * belongs here rather than only at the write path: this is the layer that
 * knows BigQuery's constraint, and it also covers rows already in Firestore.
 */
const NUMERIC_SCALE = 9;

const NUMERIC_FIELDS_BY_TABLE = new Map<string, string[]>(
  STATS_TABLES.map((table) => [
    table.name,
    table.fields.filter((f) => f.type === "NUMERIC").map((f) => f.name),
  ])
);

/** Rounds every NUMERIC-typed field to a scale BigQuery can store. Rows that
 *  need no clamping are passed through by reference, not copied. */
export function clampNumericFields(
  table: string,
  rows: StatsRow[],
  /** Reports each non-finite value dropped to NULL, so the sink can log it. */
  onNonFinite?: (field: string, value: number) => void
): StatsRow[] {
  const fields = NUMERIC_FIELDS_BY_TABLE.get(table);
  if (!fields || fields.length === 0) return rows;
  return rows.map((row) => {
    let clamped: StatsRow | null = null;
    for (const field of fields) {
      const value = row[field];
      if (typeof value !== "number") continue;
      if (!Number.isFinite(value)) {
        // JSON serialization would turn NaN/Infinity into null on its way to
        // BigQuery anyway. Do it deliberately and report it, so the value is
        // dropped on purpose instead of vanishing as a side effect — the same
        // silent-loss trap this whole change exists to close. No writer
        // should produce one; the report is how we'd find out otherwise.
        onNonFinite?.(field, value);
        clamped ??= { ...row };
        clamped[field] = null;
        continue;
      }
      const rounded = Number(value.toFixed(NUMERIC_SCALE));
      if (rounded === value) continue;
      clamped ??= { ...row };
      clamped[field] = rounded;
    }
    return clamped ?? row;
  });
}

/**
 * Surface what BigQuery actually rejected.
 *
 * `PartialFailureError` (@google-cloud/common) builds its `message` from
 * `errors[].message`, but insertAll failures carry `{index, errors, row}`
 * with no `message` — so the message ends up EMPTY. firebase-functions'
 * `onSchedule` wrapper then logs `err.message` and nothing else, which is why
 * the 2026-08-28 failure reached Cloud Logging as a bare "Error" with a stack
 * rooted in the logger itself and no way to tell which row was at fault.
 *
 * Logging the offending rows is safe: per `schema.ts` they carry only
 * pseudonymized fields (no names, emails, tag UIDs or reference numbers).
 */
function logInsertFailure(table: string, err: unknown): void {
  const { errors } = err as { errors?: unknown };
  const reason =
    err instanceof Error && err.message ? err.message : String(err);
  logger.error(`stats sink: BigQuery insert into ${table} failed`, {
    table,
    reason,
    insertErrors: JSON.stringify(errors ?? null).slice(0, 20000),
  });
}

/** Counts would-be inserts without storing them (backfill --dry-run). */
export class CountingSink implements StatsSink {
  readonly counts: Record<string, number> = {};

  async insertRows(table: string, rows: StatsRow[]): Promise<void> {
    this.counts[table] = (this.counts[table] ?? 0) + rows.length;
  }
}

/**
 * Real BigQuery sink. The client lib is imported lazily so authCall & friends
 * don't pay its require() cost on every cold start (ADR-0037 keep-warm care).
 *
 * Uses the legacy streaming `insertAll` — no free tier, but at our volume
 * (a few MB/year) that is cents; do not "optimize" this to load jobs without
 * reading the sizing note in ADR-0039.
 */
export async function makeBigQuerySink(
  datasetId: string,
  projectId?: string
): Promise<StatsSink> {
  const { BigQuery } = await import("@google-cloud/bigquery");
  const bq = new BigQuery(projectId ? { projectId } : {});
  // visit_items fans out per checkout with no cap, so a 500-checkout batch
  // can exceed one insertAll request comfortably handles — chunk it.
  const INSERT_CHUNK = 500;
  return {
    async insertRows(table, rows) {
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const chunk = clampNumericFields(
          table,
          rows.slice(i, i + INSERT_CHUNK),
          (field, value) =>
            logger.warn(
              `stats sink: non-finite ${table}.${field} dropped to NULL`,
              { table, field, value: String(value) }
            )
        );
        try {
          await bq.dataset(datasetId).table(table).insert(chunk);
        } catch (err) {
          logInsertFailure(table, err);
          throw err;
        }
      }
    },
  };
}
