// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Reading the release versions every component reports (ADR-0045):
 * `2026.10.3` (a release), `2026.10.3-dev.4+g1a2b3c4d[.dirty]` (a build after
 * it), `0.0.0-dev+g…` (no release yet), `dev` (a local build). Used by the
 * admin "Versionen" page; scripts/deploy/build-version.ts produces the strings.
 */

export interface ParsedVersion {
  /** [year, month, n] of the release the build is based on. */
  release: [number, number, number]
  /** Commits after the release; null for the release itself. */
  dev: number | null
  dirty: boolean
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-dev(?:\.(\d+))?)?(?:\+g[0-9a-f]+(\.dirty)?)?$/

export function parseBuildVersion(version: string | null | undefined): ParsedVersion | null {
  const m = version?.match(VERSION_RE)
  if (!m) return null
  const isDev = version!.includes("-dev")
  return {
    release: [Number(m[1]), Number(m[2]), Number(m[3])],
    dev: isDev ? Number(m[4] ?? 0) : null,
    dirty: m[5] !== undefined,
  }
}

function compareRelease(a: ParsedVersion, b: ParsedVersion): number {
  for (let i = 0; i < 3; i++) {
    if (a.release[i] !== b.release[i]) return a.release[i] - b.release[i]
  }
  return 0
}

/** The newest clean release among `versions`, or null. */
export function latestRelease(versions: ReadonlyArray<string | null | undefined>): string | null {
  let best: ParsedVersion | null = null
  for (const v of versions) {
    const p = parseBuildVersion(v)
    if (!p || p.dev !== null || p.dirty || p.release[0] === 0) continue
    if (!best || compareRelease(p, best) > 0) best = p
  }
  return best ? best.release.join(".") : null
}

/**
 * - `current`: this release (or newer), clean
 * - `behind`: based on an older release than `latest`
 * - `dev`: a build that is not a release (after the latest, or dirty)
 * - `unknown`: no or unreadable version (older firmware, local "dev")
 */
export type VersionStanding = "current" | "behind" | "dev" | "unknown"

export function versionStanding(
  version: string | null | undefined,
  latest: string | null,
): VersionStanding {
  const p = parseBuildVersion(version)
  if (!p) return "unknown"
  const l = parseBuildVersion(latest)
  if (l && compareRelease(p, l) < 0) return "behind"
  if (p.dev !== null || p.dirty) return "dev"
  return "current"
}

/**
 * Whether a client built as `build` is older than the minimum version the
 * server asks for (`config/clients.minVersion`, #845). Compares the release a
 * build is based on, so `2026.11.3-dev.4+g…` is below `2026.11.4` and
 * `2026.11.4-dev.1+g…` is not. A build or minimum that isn't a release
 * version — `dev` (local and e2e builds), absent, unreadable — is never
 * below: a typo in the config must not lock every client out.
 */
export function isBelowMinVersion(
  build: string | null | undefined,
  min: string | null | undefined,
): boolean {
  const b = parseBuildVersion(build)
  const m = parseBuildVersion(min)
  if (!b || !m || b.release[0] === 0) return false
  return compareRelease(b, m) < 0
}
