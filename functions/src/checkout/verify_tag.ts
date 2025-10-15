/**
 * @fileoverview Tag verification endpoint for checkout flow
 *
 * Verifies NTAG424 DNA SDM messages and returns user/token information
 * for unauthenticated checkout via NFC tag tap.
 */

import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { decryptPICCData, verifyCMAC } from "../ntag/sdm_crypto";

/**
 * Configuration passed from middleware
 */
export interface Config {
  terminalKey: string;
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
}

/**
 * Verifies tag-based checkout request
 *
 * Flow:
 * 1. Decrypt PICC data using terminal key → extract UID + counter
 * 2. Look up token in Firestore by UID
 * 3. Verify CMAC signature using terminal key
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
  const { terminalKey } = config;

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

  const userId = userRef.id;

  // Step 3: Verify CMAC signature
  let isValid;
  try {
    isValid = verifyCMAC(cmac, piccData, terminalKey);
  } catch (error: any) {
    logger.error("CMAC verification failed", { error: error.message });
    throw new Error(`CMAC verification failed: ${error.message}`);
  }

  if (!isValid) {
    logger.warn("CMAC signature mismatch", { tokenId, userId });
    throw new Error("Invalid CMAC signature");
  }

  // Step 4: Return token and user information
  return {
    tokenId,
    userId,
    uid: uidHex,
  };
}
