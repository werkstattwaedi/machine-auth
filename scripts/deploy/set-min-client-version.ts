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
 * Refuses a minimum above what the hosting sites serve (`/version.json`):
 * every app would sit on its reload screen reloading into the old build.
 * `--force` overrides that, e.g. when a site's version can't be read.
 *
 * Needs ADC (`gcloud auth application-default login`). Records an ops event
 * in the deploy log (best effort, like every deploy record).
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isBelowMinVersion, parseBuildVersion } from "@oww/shared";
import { buildVersion } from "./build-version.ts";
import type { DeployEnv } from "./deploy-log.ts";
import { recordDeploy } from "./deploy-record.ts";

const PROJECTS: Record<DeployEnv, string> = {
  prod: process.env.DEPLOY_PROD_PROJECT || "oww-maco",
  staging: process.env.DEPLOY_STAGING_PROJECT || "oww-maco-staging",
};

/** The hosting sites (`.firebaserc` targets) whose apps the minimum applies to. */
const SITES: Record<DeployEnv, string[]> = {
  prod: ["oww-maco", "oww-maco-admin"],
  staging: ["oww-maco-staging", "oww-maco-staging-admin"],
};

async function liveVersion(site: string): Promise<string | null> {
  try {
    const res = await fetch(`https://${site}.web.app/version.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

/**
 * A minimum above what hosting serves leaves every app on a reload screen
 * that reloads into the same old build — so it is refused unless forced.
 */
export function sitesBelow(
  live: ReadonlyArray<{ site: string; version: string | null }>,
  min: string
): string[] {
  return live
    .filter(({ version }) => version === null || isBelowMinVersion(version, min))
    .map(({ site, version }) => `${site} serves ${version ?? "(unreadable)"}`);
}

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
      force: { type: "boolean", default: false },
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

  if (next !== null) {
    const live = await Promise.all(
      SITES[env].map(async (site) => ({ site, version: await liveVersion(site) }))
    );
    const below = sitesBelow(live, next);
    if (below.length > 0 && !values.force) {
      throw new Error(
        `hosting doesn't serve ${next} yet (${below.join("; ")}) — deploy hosting first, or pass --force`
      );
    }
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
