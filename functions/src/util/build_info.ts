// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The release version this functions deploy was built as (ADR-0045), e.g.
 * "2026.10.3". scripts/deploy/deploy-functions.ts writes `lib/build-info.json`
 * right before uploading; anywhere else (emulator, tests) the file is
 * absent and the version is "dev".
 *
 * Reported by the keep-warm pings: `GET /api/ping` (behind the gateway API
 * key) and the dispatchers' `ping` method, which is unauthenticated by
 * design (ADR-0037). The version is no secret — the repo and its release
 * tags are public.
 */

import { readFileSync } from "fs";
import { join } from "path";

// Compiled to lib/src/util/build_info.js → lib/build-info.json.
const BUILD_INFO_PATH = join(__dirname, "..", "..", "build-info.json");

export function readBuildVersion(path: string = BUILD_INFO_PATH): string {
  try {
    const info = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
    return typeof info.version === "string" && info.version ? info.version : "dev";
  } catch {
    return "dev";
  }
}

/** Read once per instance — the file can't change under a running deploy. */
export const BUILD_VERSION = readBuildVersion();
