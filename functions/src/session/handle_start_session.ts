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

  // Check if user exists and has valid permissions
  try {
    // First, find the user who owns this token
    const usersQuery = await admin
      .firestore()
      .collectionGroup("token")
      .where(admin.firestore.FieldPath.documentId(), "==", tokenIdHex)
      .limit(1)
      .get();

    if (usersQuery.empty) {
      logger.warn("Token not found in user database", { tokenId: tokenIdHex });
      const rejected = new RejectedT();
      rejected.message = "Token not registered";

      const response = new StartSessionResponseT();
      response.resultType = StartSessionResult.Rejected;
      response.result = rejected;
      return response;
    }

    const tokenDoc = usersQuery.docs[0];
    const tokenData = tokenDoc.data();

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

    // Get the user ID from the token document path
    const userId = tokenDoc.ref.parent.parent?.id;
    if (!userId) {
      throw new Error("Could not determine user ID from token");
    }

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
    const tokenIdReference = `/users/${userId}/token/${tokenIdHex}`;
    const existingSessionQuery = await admin
      .firestore()
      .collection("sessions")
      .where("tokenId", "==", tokenIdReference)
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
        tokenSession.permissions = userData?.permissions || [];

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
