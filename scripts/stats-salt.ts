// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Byte-exact STATS_SUBJECT_SALT for scripts that build stats rows.
 *
 * The deployed functions HMAC with the secret exactly as stored — and both
 * projects' salts were stored with a trailing newline (`openssl rand -hex
 * 32 | …secrets:set` keeps it). Passing the salt as
 * `STATS_SUBJECT_SALT="$(gcloud secrets versions access …)"` strips that
 * newline, so a script run keys every row differently from the daily
 * export: the same member shows up as two subjects. That is how the
 * staging backfill of 2026-07-19 went wrong. Scripts therefore fetch the
 * salt themselves, never through the shell.
 */

import { execFileSync } from "child_process";

export function resolveStatsSalt(opts: {
  projectId: string;
  emulator: boolean;
  dryRun: boolean;
}): string {
  if (opts.emulator || opts.dryRun) {
    // No real keys are persisted: the emulator run uses test data, a dry
    // run only counts rows.
    return process.env.STATS_SUBJECT_SALT || "dry-run-salt";
  }
  if (process.env.STATS_SUBJECT_SALT) {
    throw new Error(
      "STATS_SUBJECT_SALT is set in the environment — unset it. Live runs " +
        "fetch the salt from Secret Manager themselves, because a shell " +
        "`$(…)` strips its trailing newline and re-keys every subject."
    );
  }
  const salt = execFileSync(
    "gcloud",
    [
      "secrets",
      "versions",
      "access",
      "latest",
      "--secret=STATS_SUBJECT_SALT",
      `--project=${opts.projectId}`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
  if (!salt) {
    throw new Error(`STATS_SUBJECT_SALT in ${opts.projectId} is empty`);
  }
  return salt;
}
