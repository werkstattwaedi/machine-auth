// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Rows of the "Versionen" page (ADR-0045 phase 3): what each device
// reports, judged against the newest release anything in this project runs.

import { latestRelease, versionStanding, type VersionStanding } from "@oww/shared"
import type { DeviceStatusDoc } from "@modules/lib/firestore-entities"

export interface DeviceRow {
  key: string
  kind: DeviceStatusDoc["kind"]
  kindLabel: string
  name: string
  deviceId: string
  status: DeviceStatusDoc
  standing: VersionStanding
}

const KIND_LABEL: Record<DeviceStatusDoc["kind"], string> = {
  gateways: "Gateway",
  maco: "Terminal",
  kiosks: "Kiosk",
}

const KIND_ORDER: DeviceStatusDoc["kind"][] = ["gateways", "maco", "kiosks"]

/**
 * The release everything should be on: the newest clean release among the
 * cloud parts (functions, web apps — deployed together) and the devices.
 */
export function targetRelease(
  cloudVersions: ReadonlyArray<string | null | undefined>,
  statuses: ReadonlyArray<Pick<DeviceStatusDoc, "version">>,
): string | null {
  return latestRelease([...cloudVersions, ...statuses.map((s) => s.version)])
}

export function deviceRows(
  statuses: ReadonlyArray<DeviceStatusDoc>,
  macoNames: ReadonlyMap<string, string>,
  target: string | null,
): DeviceRow[] {
  return statuses
    .filter((s) => KIND_ORDER.includes(s.kind))
    .map((s) => ({
      key: `${s.kind}/${s.deviceId}`,
      kind: s.kind,
      kindLabel: KIND_LABEL[s.kind],
      name: (s.kind === "maco" && macoNames.get(s.deviceId)) || s.deviceId,
      deviceId: s.deviceId,
      status: s,
      standing: versionStanding(s.version, target),
    }))
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.name.localeCompare(b.name, "de"),
    )
}

/**
 * Status docs refresh `lastSeen` at most hourly while all is well (the
 * kiosk reports once a day), so "last heard" is only that precise. Longer
 * silence means the reports stopped — e.g. a dead gateway, whose own doc
 * can't say "offline". Same thresholds as scripts/deploy/deploy-log.ts.
 */
export const QUIET_AFTER_MS: Record<DeviceStatusDoc["kind"], number> = {
  gateways: 75 * 60 * 1000,
  maco: 75 * 60 * 1000,
  kiosks: 25 * 60 * 60 * 1000,
}

export function isQuiet(
  status: Pick<DeviceStatusDoc, "kind" | "online" | "lastSeen">,
  now: number,
): boolean {
  return status.online && now - status.lastSeen.toMillis() > QUIET_AFTER_MS[status.kind]
}

export const STANDING_LABEL: Record<VersionStanding, string> = {
  current: "aktuell",
  behind: "veraltet",
  dev: "Entwicklungsstand",
  unknown: "unbekannt",
}

/** maco::system::ResetReason names, as the functions store them. */
export const RESET_REASON_LABEL: Record<string, string> = {
  unknown: "unbekannt",
  watchdog: "Watchdog",
  panic: "Absturz",
  power_cycle: "Stromunterbruch",
  ota_update: "Update",
  user_requested: "manuell",
}
