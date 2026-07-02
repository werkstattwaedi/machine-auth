/**
 * @fileoverview Tag verification endpoint for checkout flow
 *
 * Verifies NTAG424 DNA SDM messages and returns user/token information
 * for unauthenticated checkout via NFC tag tap.
 */

import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { decryptPICCData, verifyCMAC, PICCData } from "../ntag/sdm_crypto";
import { diversifyKey } from "../ntag/key_diversification";
import {
  terminalKey,
  diversificationMasterKey,
  diversificationSystemName,
} from "../config/tag-secrets";
import {
  assertKioskBearer,
  buildKioskUserPayload,
  mintKioskSessionToken,
  type KioskUserPayload,
} from "./kiosk_session";

/**
 * Configuration passed from middleware
 */
export interface Config {
  terminalKey: string;
  masterKey: string;
  systemName: string;
}

/**
 * Request body for tag verification
 */
export interface VerifyTagRequest {
  picc: string;  // Hex-encoded encrypted PICC data
  cmac: string;  // Hex-encoded CMAC signature
}

/**
 * Response containing token and user information. The user fields come from
 * {@link KioskUserPayload} (`activeMembership` collapsed to a boolean —
 * issue #358; drives member pricing for tag-tap checkout).
 */
export interface VerifyTagResponse extends KioskUserPayload {
  tokenId: string;
  uid: string;  // Hex-encoded UID for debugging
  customToken: string;  // Firebase custom token for client-side auth
}

/**
 * Result of decrypting + authenticating a tapped tag.
 */
export interface VerifiedTag {
  tokenId: string;  // = UID hex; the canonical tokens/{id} document id
  uid: string;      // hex-encoded UID (same value, named for clarity)
  piccData: PICCData;
}

/**
 * Decrypts the PICC ciphertext and verifies the SDM CMAC — the trusted core
 * shared by the kiosk checkout endpoint and the admin `resolveTag` callable.
 *
 * Crucially this does NOT require a `tokens/{id}` doc to exist: the SDM MAC key
 * is diversified from `masterKey + UID`, so CMAC verification proves the tag is
 * a genuine OWW tag even before it is registered to a user. Callers decide what
 * to do with an unregistered-but-authentic tag.
 *
 * @throws Error if picc/cmac are missing, decryption fails, or the CMAC is invalid.
 */
export function decryptAndVerifyTag(
  request: VerifyTagRequest,
  config: Config
): VerifiedTag {
  const { picc, cmac } = request;
  const { terminalKey, masterKey, systemName } = config;

  // Validate inputs
  if (!picc || typeof picc !== "string") {
    throw new Error("Missing or invalid 'picc' parameter");
  }
  if (!cmac || typeof cmac !== "string") {
    throw new Error("Missing or invalid 'cmac' parameter");
  }

  // Decrypt PICC data to get UID and counter
  let piccData;
  try {
    piccData = decryptPICCData(picc, terminalKey);
  } catch (error: any) {
    logger.error("Failed to decrypt PICC data", { error: error.message });
    throw new Error(`PICC decryption failed: ${error.message}`);
  }

  const uidHex = piccData.uid.toString("hex");

  // Derive SDM MAC key (diversified Key 3) and verify CMAC. Independent of any
  // token doc, so this authenticates unregistered tags too.
  let isValid;
  try {
    const sdmMacKey = diversifyKey(masterKey, systemName, piccData.uid, "sdm_mac");
    isValid = verifyCMAC(cmac, piccData, picc, sdmMacKey);
  } catch (error: any) {
    logger.error("CMAC verification failed", { error: error.message });
    throw new Error(`CMAC verification failed: ${error.message}`);
  }

  if (!isValid) {
    logger.warn("CMAC signature mismatch", { tokenId: uidHex });
    throw new Error("Invalid CMAC signature");
  }

  return { tokenId: uidHex, uid: uidHex, piccData };
}

/**
 * Verifies tag-based checkout request
 *
 * Flow:
 * 1. Decrypt PICC + verify CMAC (shared core) → UID + counter
 * 2. Look up token in Firestore by UID (must exist, not deactivated)
 * 3. Enforce SDM counter monotonicity (replay defense)
 * 4. Mint a synthetic-UID custom token + return user information
 *
 * @param request - Request containing encrypted PICC and CMAC
 * @param config - Configuration with keys
 * @returns Token and user IDs if verification succeeds
 * @throws Error if verification fails
 */
export async function handleVerifyTagCheckout(
  request: VerifyTagRequest,
  config: Config
): Promise<VerifyTagResponse> {
  // Step 1: Decrypt + authenticate the tag (shared core).
  const { tokenId, uid: uidHex, piccData } = decryptAndVerifyTag(request, config);

  // Step 2: Look up token in Firestore by UID
  const db = getFirestore();
  const tokenRef = db.collection("tokens").doc(tokenId);
  const tokenDoc = await tokenRef.get();

  if (!tokenDoc.exists) {
    logger.warn("Token not found", { tokenId });
    throw new Error("Token not found");
  }

  const tokenData = tokenDoc.data()!;

  // Check if token is deactivated
  if (tokenData.deactivated) {
    logger.warn("Token is deactivated", { tokenId });
    throw new Error("Token is deactivated");
  }

  // Get user reference
  const userRef = tokenData.userId;
  if (!userRef) {
    logger.error("Token has no userId", { tokenId });
    throw new Error("Token has no associated user");
  }

  const realUserId = userRef.id;

  // Step 3: Verify SDM read counter is monotonically increasing (replay defense).
  // The 3-byte counter is little-endian on the wire (per NTAG SDM spec).
  // We read+write atomically so two concurrent requests with the same counter
  // can't both succeed.
  const incomingCounter =
    piccData.counter[0] |
    (piccData.counter[1] << 8) |
    (piccData.counter[2] << 16);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(tokenRef);
    // Sentinel -1: a token that has never been tapped accepts any counter
    // (including 0). After the first tap, subsequent counters must strictly
    // increase. Real NTAG counters start at 0 and only go up.
    const lastCounter =
      (snap.data()?.lastSdmCounter as number | undefined) ?? -1;
    if (incomingCounter <= lastCounter) {
      logger.warn("SDM counter replay rejected", {
        tokenId,
        userId: realUserId,
        incomingCounter,
        lastCounter,
      });
      throw new Error("SDM replay detected: counter not advancing");
    }
    tx.update(tokenRef, { lastSdmCounter: incomingCounter });
  });

  // Step 4: Fetch user details for pre-fill
  const userDoc = await userRef.get();
  const userData = userDoc.exists ? userDoc.data() : undefined;

  // Step 5: Mint the synthetic-uid kiosk session (see kiosk_session.ts for
  // why the uid must NOT be the real user's).
  const customToken = await mintKioskSessionToken(realUserId, "tag");

  // Step 6: Return token and user information.
  // `userId` in the response is the REAL user, so the client can pre-fill
  // the form. The synthetic session UID is opaque to the client.
  return {
    tokenId,
    uid: uidHex,
    customToken,
    ...buildKioskUserPayload(realUserId, userData),
  };
}

/**
 * Callable wrapper for the kiosk tag-tap checkout. Routed via the `authCall`
 * dispatcher so it shares CORS handling with every other web callable (no raw
 * Express endpoint, no hand-rolled preflight). The `bearer` is a soft
 * revocation/audit gate carried in the payload (the kiosk Electron bridge
 * supplies it); the real security is the SDM tag crypto + the synthetic-UID
 * custom token. Skipped in the emulator so E2E needs no secret in seed data.
 */
export const verifyTagCheckoutHandler = async (
  request: CallableRequest<VerifyTagRequest & { bearer?: string }>
): Promise<VerifyTagResponse> => {
  const { picc, cmac, bearer } = request.data ?? ({} as VerifyTagRequest);

  assertKioskBearer(bearer, "verifyTagCheckout");

  try {
    return await handleVerifyTagCheckout(
      { picc, cmac },
      {
        terminalKey: terminalKey.value(),
        masterKey: diversificationMasterKey.value(),
        systemName: diversificationSystemName.value(),
      }
    );
  } catch (error: any) {
    logger.error("Tag verification failed", { error: error?.message });
    throw new HttpsError(
      "invalid-argument",
      error?.message || "Tag verification failed"
    );
  }
};
