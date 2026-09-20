// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The two guards every STAGING-ONLY test hook shares (`mintTestTap`,
 * `uploadTestUsage`). These functions do things production must never offer
 * — forge badge taps, bill machine time — so each of them:
 *
 *  1. exists only when the deploy target is the staging project (the export
 *     in `index.ts` is conditional on it; firebase-tools sets GCLOUD_PROJECT to
 *     the target during discovery) and answers 404 in any other project;
 *  2. is deployed `invoker: "private"` (Google identity token of a principal
 *     with `run.invoker`) and additionally wants the STAGING kiosk bearer —
 *     the one secret that is per environment (ADR-0034).
 *
 * What each hook may touch beyond that is its own third guard.
 */

import * as crypto from "crypto";

/** The one project these functions may exist and answer in. */
export const STAGING_PROJECT_ID = "oww-maco-staging";

export function isStagingProject(
  projectId: string | undefined = process.env.GCLOUD_PROJECT
): boolean {
  return projectId === STAGING_PROJECT_ID;
}

export interface StagingCallerEnv {
  projectId: string | undefined;
  bearerKey: string;
}

export interface HookResult<T> {
  status: number;
  body: T | { error: string };
}

function sameSecret(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * `null` when the caller may proceed; otherwise the refusal to send. The
 * project is checked FIRST, so outside staging nothing about the request is
 * ever evaluated — no oracle, not even for "was my bearer right".
 */
export function refuseUnlessStagingCaller(
  bearer: unknown,
  env: StagingCallerEnv
): HookResult<never> | null {
  if (!isStagingProject(env.projectId)) {
    return { status: 404, body: { error: "not found" } };
  }
  if (
    typeof bearer !== "string" ||
    env.bearerKey.length === 0 ||
    !sameSecret(bearer, env.bearerKey)
  ) {
    return { status: 403, body: { error: "forbidden" } };
  }
  return null;
}
