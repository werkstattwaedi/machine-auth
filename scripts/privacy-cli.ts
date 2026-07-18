#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * DSAR tooling CLI (ADR-0038): report | erase | trim, calling the DEPLOYED
 * `authCall` dispatcher (or the emulator) — the CLI is a thin wrapper, all
 * logic lives in functions/src/privacy/.
 *
 * Auth: mints a custom token for the fixed uid "privacy-cli" with
 * `{admin:true}` (custom-token claims propagate into the ID token, so the
 * per-handler admin guards pass). Signing in creates that one synthetic
 * Auth user — known + documented. Prod needs service-account credentials
 * (GOOGLE_APPLICATION_CREDENTIALS or ADC with token-creator rights) and
 * `VITE_FIREBASE_API_KEY` from scripts/.env.
 *
 * Erase runs the callable, then waits (~60s, --wait-secs) and re-runs it:
 * the re-run of a completed erasure re-executes only the audit purge,
 * catching before-snapshots the async audit triggers wrote after phase B
 * (ADR-0038 race fix). It repeats until a purge pass removes nothing.
 *
 * Usage:
 *   npx tsx scripts/privacy-cli.ts report --uid <uid> [--prod]
 *   npx tsx scripts/privacy-cli.ts report --email <email> [--prod]
 *   npx tsx scripts/privacy-cli.ts erase --uid <uid> --confirm-email <email> [--dry-run] [--prod]
 *   npx tsx scripts/privacy-cli.ts trim [--cutoff-year YYYY] [--dry-run] [--prod]
 *
 * Emulator mode (default): expects `npm run dev` emulators on the standard
 * ports; override with FIREBASE_AUTH_EMULATOR_HOST / FUNCTIONS_EMULATOR_ORIGIN.
 */

import { config as loadEnv } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const PROD_MODE = argv.includes("--prod");
const DRY_RUN = argv.includes("--dry-run");
loadEnv({
  path: PROD_MODE
    ? [path.join(__dirname, ".env"), path.join(__dirname, ".env.local")]
    : [path.join(__dirname, ".env.local"), path.join(__dirname, ".env")],
});

function flagValue(name: string): string | undefined {
  const idx = argv.indexOf(`--${name}`);
  if (idx !== -1 && argv[idx + 1] && !argv[idx + 1].startsWith("--")) {
    return argv[idx + 1];
  }
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.split("=", 2)[1];
}

const REGION = "europe-west6";

interface CallTarget {
  projectId: string;
  signInUrl: string;
  authCallUrl: string;
}

function resolveTarget(projectId: string): CallTarget {
  if (PROD_MODE) {
    const apiKey = process.env.VITE_FIREBASE_API_KEY;
    if (!apiKey) {
      throw new Error("VITE_FIREBASE_API_KEY not set (scripts/.env)");
    }
    return {
      projectId,
      signInUrl: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
      authCallUrl: `https://${REGION}-${projectId}.cloudfunctions.net/authCall`,
    };
  }
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost;
  const functionsOrigin =
    process.env.FUNCTIONS_EMULATOR_ORIGIN ?? "http://127.0.0.1:5001";
  return {
    projectId,
    signInUrl: `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    authCallUrl: `${functionsOrigin}/${projectId}/${REGION}/authCall`,
  };
}

async function mintIdToken(target: CallTarget): Promise<string> {
  const admin = await import("firebase-admin");
  if (!admin.apps.length) {
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!PROD_MODE) {
      admin.initializeApp({ projectId: target.projectId });
    } else if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(
        fs.readFileSync(serviceAccountPath, "utf8")
      );
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: target.projectId,
      });
    } else {
      admin.initializeApp({ projectId: target.projectId });
    }
  }
  const customToken = await admin
    .auth()
    .createCustomToken("privacy-cli", { admin: true });
  const res = await fetch(target.signInUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!res.ok) {
    throw new Error(`signInWithCustomToken failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { idToken: string };
  return body.idToken;
}

interface RpcError {
  message: string;
  status?: string;
  details?: { blockers?: Array<{ type: string; path: string; detail: string }> };
}

async function callAuthRpc(
  target: CallTarget,
  idToken: string,
  method: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(target.authCallUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data: { method, payload } }),
  });
  const body = (await res.json()) as { result?: unknown; error?: RpcError };
  if (body.error) {
    if (body.error.details?.blockers) {
      console.error(`\nErasure blocked (${body.error.status}):`);
      for (const b of body.error.details.blockers) {
        console.error(`  - [${b.type}] ${b.path}: ${b.detail}`);
      }
      process.exit(2);
    }
    throw new Error(`${method} failed: ${body.error.status ?? ""} ${body.error.message}`);
  }
  return body.result;
}

function sleep(seconds: number): Promise<void> {
  return new Promise((r) => setTimeout(r, seconds * 1000));
}

async function main() {
  const command = argv[0];
  if (!command || !["report", "erase", "trim"].includes(command)) {
    console.error(
      "Usage: privacy-cli.ts <report|erase|trim> [--uid U | --email E] " +
        "[--confirm-email E] [--cutoff-year YYYY] [--dry-run] [--prod] [--wait-secs N]"
    );
    process.exit(1);
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID not set");
  const target = resolveTarget(projectId);
  console.error(
    `Target: ${PROD_MODE ? "PRODUCTION" : "emulator"} (${target.authCallUrl})`
  );

  const idToken = await mintIdToken(target);
  const uid = flagValue("uid");
  const email = flagValue("email");

  if (command === "report") {
    if (!uid && !email) throw new Error("report needs --uid or --email");
    const report = await callAuthRpc(target, idToken, "privacyReport", {
      uid,
      email,
    });
    // stdout carries ONLY the JSON so it can be piped to a file.
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (command === "erase") {
    if (!uid && !email) throw new Error("erase needs --uid or --email");
    const confirmEmail = flagValue("confirm-email");
    if (!DRY_RUN && !confirmEmail) {
      throw new Error("live erase needs --confirm-email (typo guard)");
    }
    const outcome = (await callAuthRpc(target, idToken, "privacyErase", {
      uid,
      email,
      confirmEmail,
      dryRun: DRY_RUN,
    })) as {
      subjectId: string;
      counts: Record<string, number>;
      actions: string[];
      auditPurged: number;
    };
    console.log(JSON.stringify(outcome, null, 2));
    if (DRY_RUN) return;

    // Async audit triggers may land AFTER phase B — re-run the purge until
    // a pass removes nothing (ADR-0038).
    const waitSecs = Number(flagValue("wait-secs") ?? (PROD_MODE ? 60 : 5));
    for (let attempt = 1; attempt <= 5; attempt++) {
      console.error(`Waiting ${waitSecs}s for late audit-trigger writes...`);
      await sleep(waitSecs);
      const rerun = (await callAuthRpc(target, idToken, "privacyErase", {
        uid,
        email,
        confirmEmail,
        dryRun: false,
      })) as { auditPurged: number };
      console.error(`Purge pass ${attempt}: ${rerun.auditPurged} late entries removed`);
      if (rerun.auditPurged === 0) {
        console.error("Erasure complete; audit log clean.");
        return;
      }
    }
    console.error(
      "WARNING: audit purge still finding entries after 5 passes — " +
        "re-run `privacy-cli.ts erase` later to finish."
    );
    process.exit(3);
  }

  if (command === "trim") {
    const cutoffYear = flagValue("cutoff-year");
    const outcome = await callAuthRpc(target, idToken, "privacyTrim", {
      cutoffYear: cutoffYear ? Number(cutoffYear) : undefined,
      dryRun: DRY_RUN,
    });
    console.log(JSON.stringify(outcome, null, 2));
    if (DRY_RUN) {
      console.error(
        "\nDry-run only. Review the counts above, then re-run without --dry-run."
      );
    }
  }
}

main().catch((err) => {
  console.error("Failed:", err.message ?? err);
  process.exit(1);
});
