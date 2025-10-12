import {
  AuthenticateNewSessionRequestT,
  AuthenticateNewSessionResponseT,
} from "../fbs";
import * as logger from "firebase-functions/logger";
import { diversifyKey } from "../ntag/key_diversification";
import { authorizeStep1 } from "../ntag/authorize";
import { toKeyBytes } from "../ntag/bytebuffer_util";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { TokenEntity } from "../types/firestore_entities";

export async function handleAuthenticateNewSession(
  request: AuthenticateNewSessionRequestT,
  options: {
    masterKey: string;
    systemName: string;
  }
): Promise<AuthenticateNewSessionResponseT> {
  logger.info("Authenticating new session", { tokenId: request.tokenId });

  if (!request.tokenId?.uid || request.tokenId.uid.length === 0) {
    throw new Error("Missing token uid in authenticate request");
  }

  if (!request.ntagChallenge || request.ntagChallenge.length === 0) {
    throw new Error("Missing ntagChallenge in authenticate request");
  }

  const uid = Buffer.from(request.tokenId.uid);
  const tokenIdHex = uid.toString("hex");

  // Look up token directly by document ID
  const tokenDoc = await admin
    .firestore()
    .collection("tokens")
    .doc(tokenIdHex)
    .get();

  if (!tokenDoc.exists) {
    throw new Error(`Token ${tokenIdHex} is not registered`);
  }

  const tokenData = tokenDoc.data() as TokenEntity;
  if (!tokenData) {
    throw new Error("Token document exists but has no data");
  }

  // Check if token is deactivated
  if (tokenData.deactivated) {
    throw new Error(`Token ${tokenIdHex} has been deactivated`);
  }

  // Get the user ID from the userId DocumentReference
  const userDoc = await tokenData.userId.get();

  // Verify the user exists and get their data
  if (!userDoc.exists) {
    throw new Error(`User ${tokenData.userId} not found`);
  }

  // Generate authorization key
  const authorizationKey = diversifyKey(
    options.masterKey,
    options.systemName,
    uid,
    "authorization"
  );

  // Perform step 1 of mutual authentication
  const challengeResponse = authorizeStep1(
    Buffer.from(request.ntagChallenge),
    toKeyBytes(authorizationKey)
  );

  // Create new session according to schema
  const sessionId = admin.firestore().collection("sessions").doc().id;
  await admin.firestore().collection("sessions").doc(sessionId).set({
    userId: userDoc.ref,
    startTime: Timestamp.now(),
    rndA: challengeResponse.cloudChallenge, // Store as byte array directly
    tokenId: tokenDoc.ref,
    usage: [], // Empty array for usage records
    // No 'closed' field - will be added when session is closed
  });

  // Return response with session ID and cloud challenge
  const response = new AuthenticateNewSessionResponseT();
  response.sessionId = sessionId;
  response.cloudChallenge = Array.from(challengeResponse.encrypted);

  return response;
}
