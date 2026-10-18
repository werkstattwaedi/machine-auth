// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Registers this project's Wallee webhook (ADR-0051): one webhook URL
 * pointing at the `walleeWebhook` function and one Transaction listener on
 * it. Idempotent — run it again after a restore, for a new environment, or
 * to re-activate a listener Wallee deactivated (the nightly reconcile logs
 * `wallee_webhook_inactive` when that happened).
 *
 * Staging and prod share one Wallee space; each registers its own URL and
 * listener, named `machine-auth <project-id>` so neither touches the
 * other's (the reconcile finds its listener by that name).
 *
 *   npx tsx scripts/wallee-webhook-setup.ts --project oww-maco-staging --dry-run
 *   npx tsx scripts/wallee-webhook-setup.ts --project oww-maco-staging
 *
 * Reads the space and user from `functions/.env.<project-id>` (written by
 * `scripts/generate-env.ts` from the operations config) and the auth key
 * from Secret Manager (`WALLEE_AUTH_KEY`, needs gcloud credentials).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Transaction, in Wallee's webhook entity list.
const TRANSACTION_ENTITY_ID = 1472041829003;
// What settles (AUTHORIZED/COMPLETED/FULFILL), what we ignore cheaply
// (FAILED), and what must raise an alert after a settlement (VOIDED).
const ENTITY_STATES = ["AUTHORIZED", "COMPLETED", "FULFILL", "FAILED", "VOIDED"];
const REGION = "europe-west6";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1] ?? null;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : null;
}

function readEnvFile(projectId: string): Record<string, string> {
  const scriptDir = dirname(new URL(import.meta.url).pathname);
  const path = resolve(scriptDir, "..", "functions", `.env.${projectId}`);
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main(): Promise<void> {
  const projectId = arg("project");
  const dryRun = process.argv.includes("--dry-run");
  if (!projectId) {
    console.error("usage: wallee-webhook-setup.ts --project <project-id> [--dry-run]");
    process.exit(2);
  }

  const env = readEnvFile(projectId);
  const space = Number(env.WALLEE_SPACE_ID);
  const userId = Number(env.WALLEE_USER_ID);
  if (!space || !userId) {
    console.error(
      `functions/.env.${projectId} has no WALLEE_SPACE_ID/WALLEE_USER_ID — ` +
        "set wallee.* in the operations config and run scripts/generate-env.ts",
    );
    process.exit(1);
  }
  const authKey = execFileSync(
    "gcloud",
    ["secrets", "versions", "access", "latest", "--secret=WALLEE_AUTH_KEY", `--project=${projectId}`],
    { encoding: "utf8" },
  ).trim();

  const name = `machine-auth ${projectId}`;
  const url = `https://${REGION}-${projectId}.cloudfunctions.net/walleeWebhook`;

  const sdk = await import("wallee");
  const configuration = new sdk.Configuration({
    httpBearerAuth: new sdk.HttpBearerAuth(userId, authKey),
  });
  const urls = new sdk.WebhookURLsService(configuration);
  const listeners = new sdk.WebhookListenersService(configuration);

  const existingUrls = (await urls.getWebhooksUrlsSearch({ space, limit: 100 })).data ?? [];
  let webhookUrl = existingUrls.find((u) => u.name === name && u.state !== "DELETED");
  if (webhookUrl && webhookUrl.url !== url) {
    console.error(
      `A webhook URL named "${name}" exists with ${webhookUrl.url}, expected ${url}. ` +
        "Fix it in the Wallee portal; this script doesn't rewrite URLs.",
    );
    process.exit(1);
  }
  if (webhookUrl) {
    console.log(`URL ok: ${webhookUrl.id} ${webhookUrl.url}`);
  } else if (dryRun) {
    console.log(`would create URL "${name}" → ${url}`);
  } else {
    webhookUrl = await urls.postWebhooksUrls({
      space,
      webhookUrlCreate: { name, url, state: "ACTIVE" },
    });
    console.log(`created URL ${webhookUrl.id} → ${url}`);
  }

  const existingListeners =
    (await listeners.getWebhooksListenersSearch({ space, limit: 100 })).data ?? [];
  const listener = existingListeners.find((l) => l.name === name && l.state !== "DELETED");
  if (!listener) {
    if (dryRun || !webhookUrl?.id) {
      console.log(`would create listener "${name}" for Transaction ${ENTITY_STATES.join(",")}`);
    } else {
      const created = await listeners.postWebhooksListeners({
        space,
        webhookListenerCreate: {
          name,
          entity: TRANSACTION_ENTITY_ID,
          entityStates: new Set(ENTITY_STATES),
          notifyEveryChange: false,
          state: "ACTIVE",
          url: webhookUrl.id,
        },
      });
      console.log(`created listener ${created.id}`);
    }
  } else {
    const states = [...(listener.entityStates ?? [])].sort().join(",");
    const wanted = [...ENTITY_STATES].sort().join(",");
    const needsUpdate = listener.state !== "ACTIVE" || states !== wanted;
    if (!needsUpdate) {
      console.log(`listener ok: ${listener.id} (${listener.state}, ${states})`);
    } else if (dryRun) {
      console.log(`would update listener ${listener.id}: ${listener.state}/${states} → ACTIVE/${wanted}`);
    } else {
      await listeners.patchWebhooksListenersId({
        id: listener.id!,
        space,
        webhookListenerUpdate: {
          state: "ACTIVE",
          entityStates: new Set(ENTITY_STATES),
          version: listener.version!,
        },
      });
      console.log(`updated listener ${listener.id} → ACTIVE/${wanted}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
