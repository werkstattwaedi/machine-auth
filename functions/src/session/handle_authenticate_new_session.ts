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

  // First, find the user who owns this token
  const usersQuery = await admin
    .firestore()
    .collectionGroup("token")
    .where(admin.firestore.FieldPath.documentId(), "==", tokenIdHex)
    .limit(1)
    .get();

  if (usersQuery.empty) {
    throw new Error(`Token ${tokenIdHex} is not registered to any user`);
  }

  const tokenDoc = usersQuery.docs[0];
  const tokenData = tokenDoc.data();

  // Check if token is deactivated
  if (tokenData.deactivated) {
    throw new Error(`Token ${tokenIdHex} has been deactivated`);
  }

  // Get the user ID from the token document path
  const userId = tokenDoc.ref.parent.parent?.id;
  if (!userId) {
    throw new Error("Could not determine user ID from token");
  }

  // Verify the user exists and get their data
  const userDoc = await admin.firestore().collection("users").doc(userId).get();
  if (!userDoc.exists) {
    throw new Error(`User ${userId} not found`);
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
  await admin
    .firestore()
    .collection("sessions")
    .doc(sessionId)
    .set({
      userId: `/users/${userId}`,
      startTime: Timestamp.now(),
      rndA: challengeResponse.cloudChallenge, // Store as byte array directly
      tokenId: `/users/${userId}/token/${tokenIdHex}`,
      usage: [], // Empty array for usage records
      // No 'closed' field - will be added when session is closed
    });

  // Return response with session ID and cloud challenge
  const response = new AuthenticateNewSessionResponseT();
  response.sessionId = sessionId;
  response.cloudChallenge = Array.from(challengeResponse.encrypted);

  return response;
}
