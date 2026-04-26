/**
 * @fileoverview Tag verification endpoint for checkout flow
 *
 * Verifies NTAG424 DNA SDM messages and returns user/token information
 * for unauthenticated checkout via NFC tag tap.
 */

import * as crypto from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import * as logger from "firebase-functions/logger";
import { decryptPICCData, verifyCMAC } from "../ntag/sdm_crypto";
import { diversifyKey } from "../ntag/key_diversification";

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
 * Response containing token and user information
 */
export interface VerifyTagResponse {
  tokenId: string;
  userId: string;
  uid: string;  // Hex-encoded UID for debugging
  customToken: string;  // Firebase custom token for client-side auth
  firstName?: string;
  lastName?: string;
  email?: string;
  userType?: string;
}

/**
 * Verifies tag-based checkout request
 *
 * Flow:
 * 1. Decrypt PICC data using terminal key (static Key 1) → extract UID + counter
 * 2. Look up token in Firestore by UID
 * 3. Derive SDM MAC key (diversified Key 3) from UID, verify CMAC
 * 4. Return token and user information
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
  const { picc, cmac } = request;
  const { terminalKey, masterKey, systemName } = config;

  // Validate inputs
  if (!picc || typeof picc !== "string") {
    throw new Error("Missing or invalid 'picc' parameter");
  }
  if (!cmac || typeof cmac !== "string") {
    throw new Error("Missing or invalid 'cmac' parameter");
  }

  // Step 1: Decrypt PICC data to get UID and counter
  let piccData;
  try {
    piccData = decryptPICCData(picc, terminalKey);
  } catch (error: any) {
    logger.error("Failed to decrypt PICC data", { error: error.message });
    throw new Error(`PICC decryption failed: ${error.message}`);
  }

  const uidHex = piccData.uid.toString("hex");

  // Step 2: Look up token in Firestore by UID
  const db = getFirestore();
  const tokenId = uidHex;  // Token ID is the UID
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

  // Step 3: Derive SDM MAC key (diversified Key 3) and verify CMAC
  let isValid;
  try {
    const sdmMacKey = diversifyKey(masterKey, systemName, piccData.uid, "sdm_mac");
    isValid = verifyCMAC(cmac, piccData, picc, sdmMacKey);
  } catch (error: any) {
    logger.error("CMAC verification failed", { error: error.message });
    throw new Error(`CMAC verification failed: ${error.message}`);
  }

  if (!isValid) {
    logger.warn("CMAC signature mismatch", { tokenId, userId: realUserId });
    throw new Error("Invalid CMAC signature");
  }

  // Step 4: Verify SDM read counter is monotonically increasing (replay defense).
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

  // Step 5: Fetch user details for pre-fill
  const userDoc = await userRef.get();
  const userData = userDoc.exists ? userDoc.data() : undefined;

  // Step 6: Create Firebase custom token with a SYNTHETIC UID so the kiosk
  // session is a different Firebase principal than the real user. This is
  // the actual security defense:
  //  - createCustomToken merges developer claims with the auth user's
  //    persistent custom claims. If we used realUserId, an admin tapping
  //    their badge would get an `admin: true` session.
  //  - With a synthetic UID, no persistent claims exist, so the kiosk
  //    session has only the claims we explicitly set here.
  // The `actsAs` claim names the real user; rules and callables use it for
  // owner checks instead of `request.auth.uid`.
  const sessionUid = `tag:${realUserId}:${crypto
    .randomBytes(12)
    .toString("base64url")}`;
  const customToken = await getAuth().createCustomToken(sessionUid, {
    tagCheckout: true,
    actsAs: realUserId,
    kioskId: "kiosk-1",
  });

  // Step 7: Return token and user information.
  // `userId` in the response is the REAL user, so the client can pre-fill
  // the form. The synthetic session UID is opaque to the client.
  return {
    tokenId,
    userId: realUserId,
    uid: uidHex,
    customToken,
    firstName: userData?.firstName,
    lastName: userData?.lastName,
    email: userData?.email,
    userType: userData?.userType,
  };
}
