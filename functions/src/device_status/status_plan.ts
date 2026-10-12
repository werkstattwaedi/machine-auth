// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Device status reports (ADR-0045, phase 2c) — the pure part: validating a
 * report and deciding whether it changes anything worth a Firestore write.
 *
 * Each device (terminal, gateway, kiosk) has one status document,
 * overwritten in place. The gateway reports every 5 minutes, so writing on
 * every report would cost ~290 writes per device per day; instead a report
 * is written only when something changed, and otherwise `lastSeen` is
 * refreshed at most hourly. A reboot alone (crash loop) is also written at
 * most hourly. Liveness itself is watched through the log line every report
 * produces, not through these documents (see handle_device_status.ts).
 */

/** Refresh `lastSeen` (and write coalesced reboots) at most this often. */
export const REFRESH_MS = 60 * 60 * 1000;

/** Boot times closer than this are the same boot (clock jitter, rounding). */
export const SAME_BOOT_TOLERANCE_MS = 2 * 60 * 1000;

/**
 * A gateway that has been up at least this long has heard from every
 * terminal still alive (they ping every 15 s); a terminal it no longer
 * reports is offline.
 */
export const GATEWAY_SETTLE_MS = 2 * 60 * 1000;

/** maco::system::ResetReason, by value. */
export const RESET_REASONS = [
  "unknown",
  "watchdog",
  "panic",
  "power_cycle",
  "ota_update",
  "user_requested",
] as const;

export function resetReasonName(value: number | null): string | null {
  if (value === null) return null;
  return RESET_REASONS[value] ?? "unknown";
}

/** Reset reasons that mean the firmware crashed or hung. */
export function isFaultReset(reason: string | null): boolean {
  return reason === "watchdog" || reason === "panic";
}

/** What a report says about one device, times in epoch ms. */
export interface DeviceState {
  version: string | null;
  online: boolean;
  bootedAt: number | null;
  resetReason: string | null;
  bootCount: number | null;
}

/** The stored document, times in epoch ms. */
export interface StoredStatus extends DeviceState {
  firstSeen: number;
  lastSeen: number;
  /** When `online` last flipped. */
  since: number;
  /** When a reboot was last written — reboots are written at most hourly. */
  rebootWrittenAt: number | null;
}

export type StatusEvent = "first_seen" | "offline" | "online" | "reboot" | "version";

export interface StatusPlan {
  write: boolean;
  events: StatusEvent[];
  doc: StoredStatus;
}

export function planStatusUpdate(
  stored: StoredStatus | undefined,
  next: DeviceState,
  now: number
): StatusPlan {
  if (!stored) {
    return {
      write: true,
      events: ["first_seen"],
      doc: { ...next, firstSeen: now, lastSeen: now, since: now, rebootWrittenAt: null },
    };
  }

  const events: StatusEvent[] = [];
  if (stored.online !== next.online) events.push(next.online ? "online" : "offline");
  if (next.version !== null && stored.version !== next.version) events.push("version");
  const rebooted =
    next.bootedAt !== null &&
    stored.bootedAt !== null &&
    Math.abs(next.bootedAt - stored.bootedAt) > SAME_BOOT_TOLERANCE_MS;

  // Online and version changes are written at once. A reboot is written at
  // once too, unless one was written within the hour: then it waits for the
  // hourly refresh, so a crash loop costs one write (and one log line) per
  // hour instead of one per report.
  const stale = now - stored.lastSeen >= REFRESH_MS;
  const rebootDue =
    rebooted &&
    (stored.rebootWrittenAt === null || now - stored.rebootWrittenAt >= REFRESH_MS);
  const write = events.length > 0 || rebootDue || stale;
  // Only a reboot that gets written is reported; a coalesced one would
  // otherwise be detected (and logged) again with every report.
  if (rebooted && write) events.push("reboot");

  return {
    write,
    events,
    doc: {
      // Fields an older sender doesn't report keep their stored value.
      version: next.version ?? stored.version,
      online: next.online,
      bootedAt: next.bootedAt ?? stored.bootedAt,
      resetReason: next.resetReason ?? stored.resetReason,
      bootCount: next.bootCount ?? stored.bootCount,
      firstSeen: stored.firstSeen,
      lastSeen: write ? now : stored.lastSeen,
      since: stored.online !== next.online ? now : stored.since,
      rebootWrittenAt: rebooted && write ? now : stored.rebootWrittenAt,
    },
  };
}

// --- Report validation ---

export class InvalidReport extends Error {}

const GATEWAY_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DEVICE_ID_RE = /^[0-9a-f]{24}$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,64}$/;
const MAX_TERMINALS = 50;

export interface TerminalReport {
  deviceId: string;
  version: string | null;
  online: boolean;
  uptimeMs: number | null;
  /** How long ago the gateway received the terminal's last ping. */
  lastPingAgoMs: number | null;
  resetReason: number | null;
  bootCount: number | null;
}

export interface GatewayReport {
  gatewayId: string;
  version: string | null;
  uptimeMs: number;
  terminals: TerminalReport[];
}

function optionalVersion(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !VERSION_RE.test(value)) {
    throw new InvalidReport("invalid version");
  }
  return value;
}

function optionalCount(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new InvalidReport(`invalid ${field}`);
  }
  return Math.floor(value);
}

export function parseKioskVersion(value: unknown): string | null {
  return optionalVersion(value);
}

export function parseGatewayReport(body: unknown): GatewayReport {
  const b = (body ?? {}) as Record<string, unknown>;
  const gateway = (b.gateway ?? {}) as Record<string, unknown>;
  if (typeof gateway.id !== "string" || !GATEWAY_ID_RE.test(gateway.id)) {
    throw new InvalidReport("invalid gateway id");
  }
  const uptimeMs = optionalCount(gateway.uptimeMs, "gateway uptime");
  if (uptimeMs === null) throw new InvalidReport("missing gateway uptime");
  if (!Array.isArray(b.terminals) || b.terminals.length > MAX_TERMINALS) {
    throw new InvalidReport("invalid terminals");
  }
  const terminals = b.terminals.map((raw): TerminalReport => {
    const t = (raw ?? {}) as Record<string, unknown>;
    if (typeof t.deviceId !== "string" || !DEVICE_ID_RE.test(t.deviceId)) {
      throw new InvalidReport("invalid device id");
    }
    if (typeof t.online !== "boolean") throw new InvalidReport("invalid online flag");
    return {
      deviceId: t.deviceId,
      version: optionalVersion(t.version),
      online: t.online,
      uptimeMs: optionalCount(t.uptimeMs, "uptime"),
      lastPingAgoMs: optionalCount(t.lastPingAgoMs, "lastPingAgoMs"),
      resetReason: optionalCount(t.resetReason, "resetReason"),
      bootCount: optionalCount(t.bootCount, "bootCount"),
    };
  });
  if (new Set(terminals.map((t) => t.deviceId)).size !== terminals.length) {
    throw new InvalidReport("duplicate device id");
  }
  return { gatewayId: gateway.id, version: optionalVersion(gateway.version), uptimeMs, terminals };
}

/** A terminal's state as of `now`, from the gateway's report. */
export function terminalState(t: TerminalReport, now: number): DeviceState {
  return {
    version: t.version,
    online: t.online,
    // Ages, not timestamps: the gateway's clock never enters the record.
    bootedAt:
      t.uptimeMs === null ? null : now - (t.lastPingAgoMs ?? 0) - t.uptimeMs,
    resetReason: resetReasonName(t.resetReason),
    bootCount: t.bootCount,
  };
}
