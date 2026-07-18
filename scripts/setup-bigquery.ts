#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Idempotent BigQuery provisioning for the stats export (ADR-0039).
 *
 * Creates the dataset (europe-west6), the append-only tables, and the
 * `*_v` dedup views from the single source of truth in
 * `functions/src/stats/schema.ts`. Safe to re-run: existing datasets and
 * tables are left untouched; view queries are updated in place so schema
 * evolution ships by re-running this script.
 *
 * IAM (documented in docs/deployment-checklist.md, not automated here):
 * the functions runtime SA needs `roles/bigquery.dataEditor` on the dataset
 * and `roles/bigquery.jobUser` on the project.
 *
 * Usage:
 *   npx tsx scripts/setup-bigquery.ts --project oww-maco-staging
 *   npx tsx scripts/setup-bigquery.ts --project oww-maco --dataset stats
 */

import { config as loadEnv } from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
loadEnv({
  path: [path.join(__dirname, ".env"), path.join(__dirname, ".env.local")],
});

function flagValue(name: string): string | undefined {
  const idx = argv.indexOf(`--${name}`);
  if (idx !== -1 && argv[idx + 1] && !argv[idx + 1].startsWith("--")) {
    return argv[idx + 1];
  }
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.split("=", 2)[1];
}

const LOCATION = "europe-west6";

async function main() {
  const projectId = flagValue("project") ?? process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("Pass --project <id> (or set FIREBASE_PROJECT_ID)");
  }
  const datasetId = flagValue("dataset") ?? "stats";

  const { BigQuery } = await import("@google-cloud/bigquery");
  const { STATS_TABLES, dedupViewQuery, viewName } = await import(
    "../functions/src/stats/schema"
  );

  const bq = new BigQuery({ projectId });
  const dataset = bq.dataset(datasetId);

  const [datasetExists] = await dataset.exists();
  if (datasetExists) {
    console.log(`Dataset ${projectId}.${datasetId} exists.`);
  } else {
    await bq.createDataset(datasetId, { location: LOCATION });
    console.log(`Created dataset ${projectId}.${datasetId} in ${LOCATION}.`);
  }

  for (const def of STATS_TABLES) {
    const table = dataset.table(def.name);
    const [tableExists] = await table.exists();
    if (tableExists) {
      console.log(`Table ${def.name} exists — leaving untouched.`);
    } else {
      await dataset.createTable(def.name, {
        description: def.description,
        schema: { fields: def.fields },
        timePartitioning: { type: "DAY", field: def.partitionField },
        clustering: { fields: def.clusterFields },
      });
      console.log(`Created table ${def.name}.`);
    }

    const view = dataset.table(viewName(def.name));
    const query = dedupViewQuery(datasetId, def.name);
    const [viewExists] = await view.exists();
    if (viewExists) {
      await view.setMetadata({ view: { query, useLegacySql: false } });
      console.log(`Updated view ${viewName(def.name)}.`);
    } else {
      await dataset.createTable(viewName(def.name), {
        view: { query, useLegacySql: false },
      });
      console.log(`Created view ${viewName(def.name)}.`);
    }
  }

  console.log("Done. Analysts query only the *_v views.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
