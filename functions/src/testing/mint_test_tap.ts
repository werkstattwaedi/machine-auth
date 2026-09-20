// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `mintTestTap` — STAGING-ONLY: produce the `picc` / `cmac` of a badge tap
 * for a VIRTUAL tag, so the post-deploy smoke test can exercise the real
 * tag crypto (`verifyTagCheckout`, `probeTag`, badge purchase) on staging
 * without a reader, a physical tag, or the tag keys on the test machine.
 *
 * Why this needs three independent guards: staging shares
 * `TERMINAL_KEY` / `DIVERSIFICATION_MASTER_KEY` with production (ADR-0034,
 * so personalized tags work on both). Whoever can call an unrestricted
 * minter can forge a tap for ANY member's real badge — valid on production
 * too — even though no key ever leaves the server.
 *
 *  1. Staging only. The export in `index.ts` is conditional on the target
 *     project (firebase-tools sets GCLOUD_PROJECT during discovery, so a
 *     prod deploy never even sees the function), and the handler re-checks
 *     the runtime project — a function that somehow reached another project
 *     answers 404 to everything.
 *  2. Caller identity. Deployed `invoker: "private"`: Cloud Run rejects any
 *     request without a Google identity token of a principal holding
 *     `run.invoker` (`gcloud auth print-identity-token`). On top of that the
 *     staging kiosk bearer, so a stray IAM grant alone is not enough.
 *  3. Virtual UIDs only. Real NTAG 424 UIDs start with NXP's manufacturer
 *     byte 0x04. Minting is limited to a reserved prefix no real tag can
 *     have; such a UID is never registered in production, so a minted tap is
 *     worthless there.
 */

import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import {
  diversificationMasterKey,
  diversificationSystemName,
  kioskBearer,
  kioskBearerKey,
  terminalKey,
} from "../config/tag-secrets";
import { mintSdmTap } from "../ntag/sdm_mint";
import {
  isStagingProject,
  refuseUnlessStagingCaller,
  STAGING_PROJECT_ID,
} from "./staging_guard";

export { isStagingProject, STAGING_PROJECT_ID };

/**
 * Reserved first UID byte for virtual test tags. Must never be 0x04 (NXP):
 * that is what every real badge starts with.
 */
export const VIRTUAL_UID_PREFIX = "f0";
const VIRTUAL_UID = new RegExp(`^${VIRTUAL_UID_PREFIX}[0-9a-f]{12}$`);

export interface MintTestTapEnv {
  projectId: string | undefined;
  bearerKey: string;
  terminalKey: string;
  masterKey: string;
  systemName: string;
}

export interface MintTestTapResult {
  status: number;
  body: { picc: string; cmac: string } | { error: string };
}

/** The function's logic, free of the HTTP/secret plumbing (unit-tested). */
export function handleMintTestTap(
  input: { uid?: unknown; counter?: unknown; bearer?: unknown } | undefined,
  env: MintTestTapEnv
): MintTestTapResult {
  const refusal = refuseUnlessStagingCaller(input?.bearer, env);
  if (refusal) return refusal;
  const uid = typeof input?.uid === "string" ? input.uid.toLowerCase() : "";
  if (!VIRTUAL_UID.test(uid)) {
    return {
      status: 400,
      body: {
        error: `uid must be a virtual test UID (${VIRTUAL_UID_PREFIX} + 12 hex chars)`,
      },
    };
  }
  const counter = input?.counter;
  if (
    typeof counter !== "number" ||
    !Number.isInteger(counter) ||
    counter < 0 ||
    counter > 16777215
  ) {
    return { status: 400, body: { error: "counter must be an integer 0-16777215" } };
  }

  return {
    status: 200,
    body: mintSdmTap(
      uid,
      counter,
      env.terminalKey,
      env.masterKey,
      env.systemName
    ),
  };
}

export function createMintTestTap() {
  return onRequest(
    {
      invoker: "private",
      secrets: [terminalKey, diversificationMasterKey, kioskBearerKey],
      maxInstances: 2,
    },
    (req, res) => {
      if (req.method !== "POST") {
        res.status(405).json({ error: "POST only" });
        return;
      }
      const result = handleMintTestTap(req.body, {
        projectId: process.env.GCLOUD_PROJECT,
        bearerKey: kioskBearer(),
        terminalKey: terminalKey.value(),
        masterKey: diversificationMasterKey.value(),
        systemName: diversificationSystemName.value(),
      });
      // Never log the minted values or the bearer — only that it happened.
      if (result.status === 200) {
        logger.info("mintTestTap: minted a virtual tap", {
          uid: String(req.body?.uid).toLowerCase(),
        });
      } else {
        logger.warn("mintTestTap: refused", { status: result.status });
      }
      res.status(result.status).json(result.body);
    }
  );
}
