// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Sets the minimum web-app version (#845, docs/spec/apps.md APP-2/APP-3):
 * `config/clients.minVersion`. Every open app older than it shows its reload
 * screen, and the dispatchers refuse its calls. Run it right after the
 * hosting deploy of a release whose data change old apps can't handle (a
 * deploy step says when) — never before: the apps reload onto whatever
 * hosting serves.
 *
 *   npx tsx scripts/deploy/set-min-client-version.ts --env staging            # this checkout's release
 *   npx tsx scripts/deploy/set-min-client-version.ts --env prod --version 2026.11.4
 *   npx tsx scripts/deploy/set-min-client-version.ts --env prod --clear
 *
 * Needs ADC (`gcloud auth application-default login`). Records an ops event
 * in the deploy log (best effort, like every deploy record).
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBuildVersion } from "@oww/shared";
import { buildVersion } from "./build-version.ts";
import type { DeployEnv } from "./deploy-log.ts";
import { recordDeploy } from "./deploy-record.ts";

const PROJECTS: Record<DeployEnv, string> = {
  prod: process.env.DEPLOY_PROD_PROJECT || "oww-maco",
  staging: process.env.DEPLOY_STAGING_PROJECT || "oww-maco-staging",
};

/** Only a clean release may become the minimum (a dev build string would be ignored by every client). */
export function validMinVersion(v: string): boolean {
  const p = parseBuildVersion(v);
  return p !== null && p.dev === null && !p.dirty && p.release[0] !== 0;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      env: { type: "string" },
      version: { type: "string" },
      clear: { type: "boolean", default: false },
    },
  });
  const env = values.env as DeployEnv | undefined;
  if (env !== "staging" && env !== "prod") throw new Error("--env must be staging or prod");
  if (values.clear && values.version) throw new Error("--clear and --version exclude each other");

  const next = values.clear ? null : (values.version ?? buildVersion());
  if (next !== null && !validMinVersion(next)) {
    throw new Error(
      `"${next}" is not a release version (expected e.g. 2026.11.4) — pass --version or run from a released commit`
    );
  }

  const { initializeApp } = await import("firebase-admin/app");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
  const projectId = PROJECTS[env];
  const ref = getFirestore(initializeApp({ projectId })).collection("config").doc("clients");

  const before = (await ref.get()).get("minVersion") ?? null;
  console.log(`${projectId}: config/clients.minVersion ${before ?? "(none)"} → ${next ?? "(none)"}`);
  if (before === next) return;
  await ref.set(
    { minVersion: next, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  try {
    await recordDeploy({
      kind: "event",
      env,
      component: "ops",
      note: next ? `minimum web-app version ${next}` : "minimum web-app version cleared",
    });
  } catch (e) {
    console.warn(`not recorded: ${(e as Error).message}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error((e as Error).message);
      process.exit(1);
    }
  );
}
