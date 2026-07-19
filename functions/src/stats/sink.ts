// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * StatsSink — the seam between the export pipeline and BigQuery (ADR-0039).
 *
 * There is no BigQuery emulator, so all export logic is exercised through
 * this interface: tests use InMemorySink, `backfill-stats.ts --dry-run` uses
 * CountingSink, and production uses the real BigQuery streaming insert.
 */

import type { StatsRow } from "./row_builders";

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
        await bq
          .dataset(datasetId)
          .table(table)
          .insert(rows.slice(i, i + INSERT_CHUNK));
      }
    },
  };
}
