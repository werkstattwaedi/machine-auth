// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview probeTag — read-only tag classification for the kiosk.
 *
 * When a badge is tapped MID-SESSION, the kiosk must learn whether it is
 * registered (→ switch-user dialog, existing behavior) or an unregistered
 * self-service badge (→ purchase dialog) BEFORE deciding what to show.
 * A full `verifyTagCheckout` is unusable as a pre-check: it consumes the
 * one-shot SDM counter (issue #420, verify-exactly-once), so the later
 * real sign-in of a registered badge would be rejected as a replay.
 *
 * This is the kiosk-bearer-gated analog of the admin `resolveTag`:
 * decrypt + CMAC-verify only — NO counter advance, NO session mint. For
 * unregistered badges it returns the signed purchase voucher (proof of
 * physical tap, see badge/voucher.ts).
 */

import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { CallableRequest, HttpsError } from "firebase-functions/v2/https";
import {
  terminalKey,
  diversificationMasterKey,
  diversificationSystemName,
} from "../config/tag-secrets";
import { decryptAndVerifyTag, type VerifyTagRequest } from "./verify_tag";
import { assertKioskBearer } from "./kiosk_session";
import { mintBadgeVoucher } from "../badge/voucher";

export interface ProbeTagResponse {
  tokenId: string;
  registered: boolean;
  deactivated: boolean;
  /** Present only for authentic unregistered badges — the purchase voucher. */
  badgeVoucher?: string;
}

export const probeTagHandler = async (
  request: CallableRequest<VerifyTagRequest & { bearer?: string }>
): Promise<ProbeTagResponse> => {
  const { picc, cmac, bearer } = request.data ?? ({} as VerifyTagRequest);
  assertKioskBearer(bearer, "probeTag");

  const masterKey = diversificationMasterKey.value();
  let verified;
  try {
    verified = decryptAndVerifyTag(
      { picc, cmac },
      {
        terminalKey: terminalKey.value(),
        masterKey,
        systemName: diversificationSystemName.value(),
      }
    );
  } catch (error: any) {
    logger.error("probeTag verification failed", { error: error?.message });
    throw new HttpsError(
      "invalid-argument",
      error?.message || "Tag verification failed"
    );
  }

  const { tokenId, piccData } = verified;
  const tokenDoc = await getFirestore()
    .collection("tokens")
    .doc(tokenId)
    .get();

  if (!tokenDoc.exists) {
    const sdmCounter =
      piccData.counter[0] |
      (piccData.counter[1] << 8) |
      (piccData.counter[2] << 16);
    return {
      tokenId,
      registered: false,
      deactivated: false,
      badgeVoucher: mintBadgeVoucher({ tokenId, sdmCounter }, masterKey),
    };
  }

  return {
    tokenId,
    registered: true,
    deactivated: !!tokenDoc.data()?.deactivated,
  };
};
