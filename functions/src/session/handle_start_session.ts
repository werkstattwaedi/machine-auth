import {
  StartSessionRequest,
  StartSessionResponse,
  TokenSession,
} from "../proto/firebase_rpc/session.js";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {
  isSessionExpired,
  calculateSessionExpiration,
} from "../util/session_expiration";
import {
  TokenEntity,
  UserEntity,
  SessionEntity,
} from "../types/firestore_entities";

export async function handleStartSession(
  request: StartSessionRequest,
  options: {
    masterKey: string;
    systemName: string;
  }
): Promise<StartSessionResponse> {
  logger.info("Starting session for token", { tokenId: request.tokenId });

  if (!request.tokenId?.uid) {
    throw new Error("Missing token uid in startSession request");
  }

  const uid = Buffer.from(request.tokenId.uid);
  const tokenIdHex = uid.toString("hex");

  logger.info("Looking up token", {
    tokenIdHex,
    uidBytes: Array.from(uid),
    uidLength: uid.length,
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
        searchedPath: `tokens/${tokenIdHex}`,
      });
      return {
        result: { $case: "rejected", rejected: { message: "Token not registered" } },
      };
    }

    const tokenData = tokenDoc.data() as TokenEntity;
    if (!tokenData) {
      throw new Error("Token document exists but has no data");
    }

    // Check if token is deactivated
    if (tokenData.deactivated) {
      logger.warn("Token is deactivated", { tokenId: tokenIdHex });
      return {
        result: { $case: "rejected", rejected: { message: "Token deactivated" } },
      };
    }

    // Get user data
    const userDoc = await tokenData.userId.get();
    if (!userDoc.exists) {
      throw new Error(`User ${tokenData.userId} not found`);
    }
    const userData = userDoc.data() as UserEntity;

    // Check for existing non-closed session (most recent first)
    const existingSessionQuery = await admin
      .firestore()
      .collection("sessions")
      .where("tokenId", "==", tokenDoc.ref)
      .where("closed", "==", null) // Only get non-closed sessions
      .orderBy("startTime", "desc") // Get the most recent first
      .limit(1)
      .get();

    if (!existingSessionQuery.empty) {
      const sessionDoc = existingSessionQuery.docs[0];
      const sessionData = sessionDoc.data() as SessionEntity;

      // Check if the most recent session has expired
      if (!isSessionExpired(sessionData.startTime)) {
        // Return existing valid session
        const expiration = calculateSessionExpiration(sessionData.startTime);

        const session: TokenSession = {
          tokenId: request.tokenId,
          sessionId: sessionDoc.id,
          expiration: BigInt(expiration.seconds),
          userId: userDoc.id,
          userLabel: userData.displayName || "Unknown User",
          permissions: userData.permissions.map((p) => p.id),
        };

        return {
          result: { $case: "session", session },
        };
      }
    }

    // User exists but needs authentication - return AuthRequired
    logger.info("User found, authentication required", { id: userDoc.id });
    return {
      result: { $case: "authRequired", authRequired: {} },
    };
  } catch (error) {
    logger.error("Error during start session", error);
    return {
      result: { $case: "rejected", rejected: { message: "Internal server error" } },
    };
  }
}
