// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Device status reports (ADR-0045, phase 2c) — the Firestore and logging
 * side.
 *
 * Status documents live next to their device, in a `status` subcollection
 * that the audit trigger (`maco/{docId}`) doesn't see:
 *
 *   maco/{deviceId}/status/current      terminals, reported by the gateway
 *   gateways/{gatewayId}/status/current the gateway itself
 *   kiosks/{kioskId}/status/current     the checkout kiosk
 *
 * Senders:
 *   - The gateway: `POST /api/device-status` (GATEWAY_API_KEY) every 5
 *     minutes and at once when a terminal drops out, comes back or reboots.
 *   - The kiosk: `authCall` → `reportKioskStatus` (kiosk bearer) on load.
 *
 * Liveness is alerted on from the logs, not from these documents:
 *   - every gateway report logs `gateway_heartbeat` (INFO); a Cloud
 *     Monitoring metric-absence condition fires when it stops;
 *   - a terminal dropping out logs `terminal_offline` (WARNING); a
 *     log-match policy fires on the event — not on the severity, which
 *     stays below ERROR as for every device-triggered message.
 */

import {
  type DocumentData,
  type DocumentReference,
  type Firestore,
  getFirestore,
  Timestamp,
} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

import { assertKioskBearer } from "../checkout/kiosk_session";
import {
  type DeviceState,
  GATEWAY_SETTLE_MS,
  type GatewayReport,
  InvalidReport,
  isFaultReset,
  parseGatewayReport,
  parseKioskVersion,
  planStatusUpdate,
  type StatusPlan,
  type StoredStatus,
  terminalHeardAt,
  terminalState,
} from "./status_plan";

export type DeviceKind = "maco" | "gateways" | "kiosks";

const KIND_LABEL: Record<DeviceKind, string> = {
  maco: "terminal",
  gateways: "gateway",
  kiosks: "kiosk",
};

export function statusRef(db: Firestore, kind: DeviceKind, id: string): DocumentReference {
  return db.collection(kind).doc(id).collection("status").doc("current");
}

function ms(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function ts(value: number | null): Timestamp | null {
  return value === null ? null : Timestamp.fromMillis(value);
}

export function fromStatusDoc(data: DocumentData | undefined): StoredStatus | undefined {
  if (!data) return undefined;
  const firstSeen = ms(data.firstSeen);
  const lastSeen = ms(data.lastSeen);
  if (firstSeen === null || lastSeen === null) return undefined;
  return {
    version: typeof data.version === "string" ? data.version : null,
    online: data.online === true,
    bootedAt: ms(data.bootedAt),
    resetReason: typeof data.resetReason === "string" ? data.resetReason : null,
    bootCount: typeof data.bootCount === "number" ? data.bootCount : null,
    firstSeen,
    lastSeen,
    since: ms(data.since) ?? firstSeen,
    rebootWrittenAt: ms(data.rebootWrittenAt),
  };
}

/**
 * `kind` and `deviceId` repeat the path so the admin page, which reads all
 * of them as the "status" collection group, can tell them apart.
 */
function toStatusDoc(doc: StoredStatus, kind: DeviceKind, id: string): DocumentData {
  return {
    kind,
    deviceId: id,
    version: doc.version,
    online: doc.online,
    bootedAt: ts(doc.bootedAt),
    resetReason: doc.resetReason,
    bootCount: doc.bootCount,
    firstSeen: ts(doc.firstSeen),
    lastSeen: ts(doc.lastSeen),
    since: ts(doc.since),
    rebootWrittenAt: ts(doc.rebootWrittenAt),
  };
}

function logEvents(
  kind: DeviceKind,
  id: string,
  plan: StatusPlan,
  context: Record<string, unknown>
): void {
  const fields = { kind: KIND_LABEL[kind], deviceId: id, version: plan.doc.version, ...context };
  for (const event of plan.events) {
    switch (event) {
      case "first_seen":
        logger.info("device_first_seen", { event: "device_first_seen", ...fields });
        break;
      case "offline":
        logger.warn(`${KIND_LABEL[kind]}_offline`, { event: `${KIND_LABEL[kind]}_offline`, ...fields });
        break;
      case "online":
        logger.info(`${KIND_LABEL[kind]}_online`, { event: `${KIND_LABEL[kind]}_online`, ...fields });
        break;
      case "reboot": {
        // A watchdog or panic reset is the firmware failing, worth the
        // daily digest; a power cycle or update is routine.
        const log = isFaultReset(plan.doc.resetReason) ? logger.warn : logger.info;
        log("device_reboot", {
          event: "device_reboot",
          resetReason: plan.doc.resetReason,
          bootCount: plan.doc.bootCount,
          ...fields,
        });
        break;
      }
      case "version":
        logger.info("device_version", { event: "device_version", ...fields });
        break;
    }
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** Apply one gateway report: the gateway's own status and its terminals'. */
export async function applyGatewayReport(
  report: GatewayReport,
  now: number = Date.now(),
  db: Firestore = getFirestore()
): Promise<{ writes: number }> {
  const gatewayRef = statusRef(db, "gateways", report.gatewayId);
  const gatewaySnap = await gatewayRef.get();
  const gatewayData = gatewaySnap.data();
  const knownOnline: string[] = Array.isArray(gatewayData?.terminals)
    ? gatewayData.terminals.filter((t: unknown): t is string => typeof t === "string")
    : [];

  // A terminal the gateway reported online before but no longer mentions
  // died while the gateway restarted (it forgets terminals). Once the
  // gateway has been up long enough to have heard every live terminal, the
  // missing ones are offline.
  const reported = new Map(report.terminals.map((t) => [t.deviceId, t]));
  const settled = report.uptimeMs >= GATEWAY_SETTLE_MS;
  // Skipped terminals were mentioned, i.e. alive — never "unheard".
  const mentioned = new Set([...reported.keys(), ...report.skippedIds]);
  const unheard = knownOnline.filter((id) => !mentioned.has(id));
  const ids = [...reported.keys(), ...(settled ? unheard : [])];

  const refs = ids.map((id) => statusRef(db, "maco", id));
  const snaps = refs.length > 0 ? await db.getAll(...refs) : [];
  const batch = db.batch();
  let writes = 0;
  const context = { gatewayId: report.gatewayId };

  ids.forEach((id, i) => {
    const stored = fromStatusDoc(snaps[i].data());
    const t = reported.get(id);
    let next: DeviceState;
    let heardAt: number | null;
    if (t) {
      next = terminalState(t, now);
      heardAt = terminalHeardAt(t, now);
    } else if (stored) {
      next = { ...stored, online: false };
      heardAt = null; // not heard since the gateway restarted
    } else {
      return; // unheard and never stored: nothing to say
    }
    const plan = planStatusUpdate(stored, next, now, heardAt);
    logEvents("maco", id, plan, context);
    if (plan.write) {
      batch.set(refs[i], { ...toStatusDoc(plan.doc, "maco", id), gatewayId: report.gatewayId });
      writes++;
    }
  });

  const online = [
    ...report.terminals.filter((t) => t.online).map((t) => t.deviceId),
    ...(settled ? [] : unheard),
    // Mentioned but unreadable: keep whatever the list said about them.
    ...report.skippedIds.filter((id) => knownOnline.includes(id)),
  ].sort();
  const gatewayPlan = planStatusUpdate(
    fromStatusDoc(gatewayData),
    {
      version: report.version,
      online: true,
      bootedAt: now - report.uptimeMs,
      resetReason: null,
      bootCount: null,
    },
    now
  );
  logEvents("gateways", report.gatewayId, gatewayPlan, {});
  if (gatewayPlan.write) {
    batch.set(gatewayRef, {
      ...toStatusDoc(gatewayPlan.doc, "gateways", report.gatewayId),
      terminals: online,
    });
    writes++;
  } else if (!sameSet(knownOnline, online)) {
    // Only the online list changed: write just that, so a reboot the plan
    // is holding back (crash loop) isn't stored without its log line.
    batch.set(gatewayRef, { terminals: online }, { merge: true });
    writes++;
  }

  if (writes > 0) await batch.commit();
  return { writes };
}

/** Express handler for `POST /api/device-status` (behind the API-key check). */
export async function deviceStatusHandler(
  req: { body: unknown },
  res: { status(code: number): { send(body: unknown): unknown } }
): Promise<void> {
  let report: GatewayReport;
  try {
    report = parseGatewayReport(req.body);
  } catch (e) {
    if (!(e instanceof InvalidReport)) throw e;
    logger.warn("device-status rejected", { reason: e.message });
    res.status(400).send({ message: e.message });
    return;
  }
  if (report.problems.length > 0) {
    // Firmware-sent data the report carried but we couldn't use; the rest
    // of the report is applied. WARNING: device-triggered, daily digest.
    logger.warn("device-status: dropped invalid terminal data", {
      gatewayId: report.gatewayId,
      problems: report.problems.slice(0, 20),
    });
  }
  const { writes } = await applyGatewayReport(report);
  // The liveness signal: a Cloud Monitoring metric-absence condition on this
  // line fires when a gateway stops reporting (ADR-0045).
  logger.info("gateway_heartbeat", {
    event: "gateway_heartbeat",
    gatewayId: report.gatewayId,
    version: report.version,
    terminals: report.terminals.length,
    online: report.terminals.filter((t) => t.online).length,
    writes,
  });
  res.status(200).send({ ok: true });
}

const KIOSK_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * `authCall` → `reportKioskStatus`: the checkout app in kiosk mode reports
 * the kiosk build it runs in. Bearer-gated like the other kiosk callables;
 * one kiosk per environment, so the id defaults to "checkout".
 */
export async function reportKioskStatusHandler(
  request: CallableRequest<{ bearer?: string; version?: unknown; kioskId?: unknown }>
): Promise<{ ok: true }> {
  const { bearer, version, kioskId } = request.data ?? {};
  assertKioskBearer(bearer, "reportKioskStatus");
  const id = kioskId === undefined ? "checkout" : kioskId;
  let parsedVersion: string | null;
  try {
    if (typeof id !== "string" || !KIOSK_ID_RE.test(id)) throw new InvalidReport("invalid kiosk id");
    parsedVersion = parseKioskVersion(version);
  } catch (e) {
    throw new HttpsError("invalid-argument", (e as Error).message);
  }

  const db = getFirestore();
  const ref = statusRef(db, "kiosks", id);
  const now = Date.now();
  const plan = planStatusUpdate(
    fromStatusDoc((await ref.get()).data()),
    { version: parsedVersion, online: true, bootedAt: null, resetReason: null, bootCount: null },
    now
  );
  logEvents("kiosks", id, plan, {});
  if (plan.write) await ref.set(toStatusDoc(plan.doc, "kiosks", id));
  logger.info("kiosk_status", { event: "kiosk_status", kioskId: id, version: parsedVersion });
  return { ok: true };
}
