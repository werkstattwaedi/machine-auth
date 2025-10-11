import {
  StartSessionRequestT,
  StartSessionResponseT,
  StartSessionResult,
  AuthRequiredT,
  RejectedT,
  TokenSessionT,
} from "../fbs";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import {
  isSessionExpired,
  calculateSessionExpiration,
} from "../util/session_expiration";
import { assertIsDocumentReference } from "../util/firestore_helpers";

export async function handleStartSession(
  request: StartSessionRequestT,
  options: {
    masterKey: string;
    systemName: string;
  }
): Promise<StartSessionResponseT> {
  logger.info("Starting session for token", { tokenId: request.tokenId });

  if (!request.tokenId?.uid) {
    throw new Error("Missing token uid in startSession request");
  }

  const uid = Buffer.from(request.tokenId.uid);
  const tokenIdHex = uid.toString("hex");

  logger.info("Looking up token", {
    tokenIdHex,
    uidBytes: Array.from(uid),
    uidLength: uid.length
  });

  // Check if user exists and has valid permissions
  try {
    // Look up token directly by document ID
    const tokenDoc = await admin
      .firestore()
      .collection("tokens")
      .doc(tokenIdHex)
      .get();

    if (!tokenDoc.exists) {
      logger.warn("Token not found in database", {
        tokenId: tokenIdHex,
        searchedPath: `tokens/${tokenIdHex}`
      });
      const rejected = new RejectedT();
      rejected.message = "Token not registered";

      const response = new StartSessionResponseT();
      response.resultType = StartSessionResult.Rejected;
      response.result = rejected;
      return response;
    }

    const tokenData = tokenDoc.data();
    if (!tokenData) {
      throw new Error("Token document exists but has no data");
    }

    // Check if token is deactivated
    if (tokenData.deactivated) {
      logger.warn("Token is deactivated", { tokenId: tokenIdHex });
      const rejected = new RejectedT();
      rejected.message = "Token deactivated";

      const response = new StartSessionResponseT();
      response.resultType = StartSessionResult.Rejected;
      response.result = rejected;
      return response;
    }

    // Get the user ID from the userId DocumentReference
    assertIsDocumentReference(tokenData.userId, 'userId');
    const userId = String(tokenData.userId.id);

    // Get user data
    const userDoc = await admin
      .firestore()
      .collection("users")
      .doc(userId)
      .get();
    if (!userDoc.exists) {
      throw new Error(`User ${userId} not found`);
    }
    const userData = userDoc.data();

    // Check for existing non-closed session (most recent first)
    // Use DocumentReference for query to match how it's stored in Firestore
    const tokenIdDocRef = admin.firestore().doc(`tokens/${tokenIdHex}`);
    const existingSessionQuery = await admin
      .firestore()
      .collection("sessions")
      .where("tokenId", "==", tokenIdDocRef)
      .where("closed", "==", null) // Only get non-closed sessions
      .orderBy("startTime", "desc") // Get the most recent first
      .limit(1)
      .get();

    if (!existingSessionQuery.empty) {
      const sessionDoc = existingSessionQuery.docs[0];
      const sessionData = sessionDoc.data();

      // Check if the most recent session has expired
      if (!isSessionExpired(sessionData.startTime)) {
        // Return existing valid session
        const expiration = calculateSessionExpiration(sessionData.startTime);

        const tokenSession = new TokenSessionT();
        tokenSession.tokenId = request.tokenId;
        tokenSession.sessionId = sessionDoc.id;
        tokenSession.expiration = BigInt(expiration.seconds);
        tokenSession.userId = userId;
        tokenSession.userLabel = userData?.displayName || "Unknown User";

        // Extract permission IDs from DocumentReferences
        const rawPermissions = userData?.permissions || [];
        tokenSession.permissions = Array.isArray(rawPermissions)
          ? rawPermissions.map(p => {
              assertIsDocumentReference(p, 'permission');
              return String(p.id);
            })
          : [];

        const response = new StartSessionResponseT();
        response.resultType = StartSessionResult.TokenSession;
        response.result = tokenSession;
        return response;
      }
    }

    // User exists but needs authentication - return AuthRequired
    logger.info("User found, authentication required", { userId });
    const authRequired = new AuthRequiredT();

    const response = new StartSessionResponseT();
    response.resultType = StartSessionResult.AuthRequired;
    response.result = authRequired;
    return response;
  } catch (error) {
    logger.error("Error during start session", error);
    const rejected = new RejectedT();
    rejected.message = "Internal server error";

    const response = new StartSessionResponseT();
    response.resultType = StartSessionResult.Rejected;
    response.result = rejected;
    return response;
  }
}
