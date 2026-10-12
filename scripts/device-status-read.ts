// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Read what the devices report as running (ADR-0045 phase 3) for STATE.md
 * and the deploy-time drift warning: every `status` document (gateway,
 * terminals, kiosk) in both projects, plus terminal names from `maco`.
 *
 * Uses Application Default Credentials (`gcloud auth application-default
 * login`, an account with Firestore read access). Best effort: any failure
 * — no credentials, offline, a timeout — comes back as a problem string and
 * STATE.md simply says the live view was not available.
 */

import type { DeployEnv } from "./deploy-log.ts";
import type { RunningDevice } from "./deploy-log.ts";

/** Same project ids as scripts/deploy.sh. */
const PROJECTS: Record<DeployEnv, string> = {
  prod: process.env.DEPLOY_PROD_PROJECT || "oww-maco",
  staging: process.env.DEPLOY_STAGING_PROJECT || "oww-maco-staging",
};

const TIMEOUT_MS = 15_000;

function iso(value: unknown): string | null {
  const v = value as { toDate?: () => Date } | null | undefined;
  return v?.toDate ? v.toDate().toISOString() : null;
}

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what}: timed out`)), TIMEOUT_MS).unref()
    ),
  ]);
}

export async function readRunningDevices(): Promise<{
  devices: RunningDevice[];
  problems: string[];
}> {
  const devices: RunningDevice[] = [];
  const problems: string[] = [];
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return { devices, problems: ["FIRESTORE_EMULATOR_HOST is set — not reading the emulator"] };
  }
  const { deleteApp, initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  for (const env of ["prod", "staging"] as const) {
    const projectId = PROJECTS[env];
    try {
      const name = `device-status-${env}`;
      const app = getApps().find((a) => a.name === name) ?? initializeApp({ projectId }, name);
      const db = getFirestore(app);
      const [statuses, macos] = await withTimeout(
        Promise.all([db.collectionGroup("status").get(), db.collection("maco").select("name").get()]),
        projectId
      );
      const names = new Map(macos.docs.map((d) => [d.id, d.get("name") as unknown]));
      for (const doc of statuses.docs) {
        const d = doc.data();
        const kind = d.kind;
        if (kind !== "maco" && kind !== "gateways" && kind !== "kiosks") continue;
        const deviceId = typeof d.deviceId === "string" ? d.deviceId : doc.ref.parent.parent?.id ?? "?";
        const label = names.get(deviceId);
        devices.push({
          env,
          kind,
          deviceId,
          name: kind === "maco" && typeof label === "string" ? label : undefined,
          version: typeof d.version === "string" ? d.version : null,
          online: d.online === true,
          since: iso(d.since),
          lastSeen: iso(d.lastSeen),
        });
      }
    } catch (e) {
      problems.push(`${projectId}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  // Open gRPC channels would keep the deploy script alive after it is done.
  await Promise.all(
    getApps()
      .filter((a) => a.name.startsWith("device-status-"))
      .map((a) => deleteApp(a).catch(() => {}))
  );
  return { devices, problems };
}
