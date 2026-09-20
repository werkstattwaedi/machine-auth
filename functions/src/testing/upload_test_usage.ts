// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `uploadTestUsage` — STAGING-ONLY: report a finished machine session for a
 * smoke-test account, exactly as a terminal would, so the smoke run can check
 * what a member sees afterwards (the session in the cart, the machine's
 * workshop added to the visit) without a terminal, a machine or a badge.
 *
 * It feeds the REAL `handleUploadUsage` — the point is to exercise the
 * accumulation path, not a copy of it. The terminal route is not usable for
 * this: it authenticates a Particle device and speaks protobuf.
 *
 * Guards 1 + 2 are the shared ones (./staging_guard.ts). Guard 3, this hook's
 * own: it bills machine time, so it only ever does that to an account of the
 * smoke mailbox (`smoke.testing+…`) and only on a machine that exists — never
 * to one of the real people who use staging to try things out.
 */

import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { kioskBearer, kioskBearerKey } from "../config/tag-secrets";
import type { UploadUsageRequest } from "../proto/firebase_rpc/usage.js";
import { handleUploadUsage } from "../session/handle_upload_usage";
import {
  refuseUnlessStagingCaller,
  type HookResult,
  type StagingCallerEnv,
} from "./staging_guard";

/** Every account the smoke run creates is a plus-address of its one mailbox. */
export const SMOKE_EMAIL_PREFIX = "smoke.testing+";

const MAX_SESSION_SECONDS = 24 * 60 * 60;
// A terminal session outlasts the time the machine was actually running.
const DEFAULT_IDLE_SECONDS = 60;

export interface UploadTestUsageDeps {
  /** `users/{uid}.email`, or null when there is no such doc / no e-mail. */
  userEmail(uid: string): Promise<string | null>;
  machineExists(machineId: string): Promise<boolean>;
  upload(request: UploadUsageRequest): Promise<unknown>;
  nowSeconds(): number;
}

export interface UploadTestUsageBody {
  authenticationId: string;
  checkIn: number;
  checkOut: number;
}

function secondsOrNull(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_SESSION_SECONDS
    ? value
    : null;
}

/** The function's logic, free of the HTTP/secret plumbing (unit-tested). */
export async function handleUploadTestUsage(
  input:
    | {
        uid?: unknown;
        machineId?: unknown;
        activeSeconds?: unknown;
        wallClockSeconds?: unknown;
        bearer?: unknown;
      }
    | undefined,
  env: StagingCallerEnv,
  deps: UploadTestUsageDeps
): Promise<HookResult<UploadTestUsageBody>> {
  const refusal = refuseUnlessStagingCaller(input?.bearer, env);
  if (refusal) return refusal;

  const uid = input?.uid;
  const machineId = input?.machineId;
  // Doc ids only: both end up in a document path.
  if (typeof uid !== "string" || !/^[\w:-]{1,128}$/.test(uid)) {
    return { status: 400, body: { error: "uid must be a users doc id" } };
  }
  if (typeof machineId !== "string" || !/^[\w-]{1,128}$/.test(machineId)) {
    return { status: 400, body: { error: "machineId must be a machine doc id" } };
  }
  const activeSeconds = secondsOrNull(input?.activeSeconds);
  if (activeSeconds === null) {
    return {
      status: 400,
      body: { error: `activeSeconds must be an integer 0-${MAX_SESSION_SECONDS}` },
    };
  }
  const wallClockSeconds =
    input?.wallClockSeconds === undefined
      ? Math.min(MAX_SESSION_SECONDS, activeSeconds + DEFAULT_IDLE_SECONDS)
      : secondsOrNull(input.wallClockSeconds);
  if (wallClockSeconds === null || wallClockSeconds < activeSeconds) {
    return {
      status: 400,
      body: {
        error: `wallClockSeconds must be an integer activeSeconds-${MAX_SESSION_SECONDS}`,
      },
    };
  }

  const email = await deps.userEmail(uid);
  if (!email || !email.startsWith(SMOKE_EMAIL_PREFIX)) {
    return {
      status: 403,
      body: { error: `only ${SMOKE_EMAIL_PREFIX}… accounts can be billed test usage` },
    };
  }
  if (!(await deps.machineExists(machineId))) {
    return { status: 404, body: { error: "no such machine" } };
  }

  const checkOut = deps.nowSeconds();
  const checkIn = checkOut - wallClockSeconds;
  // A fresh id per call: the usage doc id derives from it, so two sessions
  // reported within the same second still count as two.
  const authenticationId = `smoke-${crypto.randomBytes(8).toString("hex")}`;
  await deps.upload({
    history: {
      machineId: { value: machineId },
      records: [
        {
          userId: { value: uid },
          authenticationId: { value: authenticationId },
          checkIn: BigInt(checkIn),
          checkOut: BigInt(checkOut),
          reason: { reason: { $case: "ui", ui: {} } },
          activeSeconds,
        },
      ],
    },
  });
  return { status: 200, body: { authenticationId, checkIn, checkOut } };
}

function defaultDeps(): UploadTestUsageDeps {
  const db = getFirestore();
  return {
    userEmail: async (uid) => {
      const email = (await db.collection("users").doc(uid).get()).get("email");
      return typeof email === "string" ? email : null;
    },
    machineExists: async (machineId) =>
      (await db.collection("machine").doc(machineId).get()).exists,
    // The tag keys are for the terminal's authentication step, which a usage
    // upload never reaches — this hook deliberately holds no tag secret.
    upload: (request) =>
      handleUploadUsage(request, { masterKey: "", systemName: "" }),
    nowSeconds: () => Math.floor(Date.now() / 1000),
  };
}

export function createUploadTestUsage() {
  return onRequest(
    { invoker: "private", secrets: [kioskBearerKey], maxInstances: 2 },
    async (req, res) => {
      if (req.method !== "POST") {
        res.status(405).json({ error: "POST only" });
        return;
      }
      try {
        const result = await handleUploadTestUsage(
          req.body,
          { projectId: process.env.GCLOUD_PROJECT, bearerKey: kioskBearer() },
          defaultDeps()
        );
        if (result.status === 200) {
          logger.info("uploadTestUsage: reported a test session", {
            uid: req.body?.uid,
            machineId: req.body?.machineId,
          });
        } else {
          logger.warn("uploadTestUsage: refused", { status: result.status });
        }
        res.status(result.status).json(result.body);
      } catch (err) {
        // Only ever called by the smoke run's operator — the failure is theirs
        // to read, and a broken accumulation path is what the run looks for.
        logger.warn("uploadTestUsage: upload failed", { err });
        res.status(500).json({ error: String((err as Error)?.message ?? err) });
      }
    }
  );
}
