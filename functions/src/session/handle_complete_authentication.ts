import {
  CompleteAuthenticationRequest,
  CompleteAuthenticationResponse,
  TokenSession,
} from "../proto/firebase_rpc/session.js";
import { TagUid } from "../proto/common.js";
import * as logger from "firebase-functions/logger";
import { authorizeStep2 } from "../ntag/authorize";
import { diversifyKey } from "../ntag/key_diversification";
import { toKeyBytes } from "../ntag/bytebuffer_util";
import * as admin from "firebase-admin";
import { SessionEntity, UserEntity } from "../types/firestore_entities";

export async function handleCompleteAuthentication(
  request: CompleteAuthenticationRequest,
  options: {
    masterKey: string;
    systemName: string;
  }
): Promise<CompleteAuthenticationResponse> {
  logger.info("Completing authentication", { sessionId: request.sessionId });

  if (!request.sessionId) {
    throw new Error("Missing sessionId");
  }

  if (
    !request.encryptedNtagResponse ||
    request.encryptedNtagResponse.length === 0
  ) {
    throw new Error("Missing encryptedNtagResponse");
  }

  const sessionId = request.sessionId as string;

  try {
    // Get session data
    const sessionDoc = await admin
      .firestore()
      .collection("sessions")
      .doc(sessionId)
      .get();

    if (!sessionDoc.exists) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const sessionData = sessionDoc.data() as SessionEntity;
    if (!sessionData?.rndA || !sessionData?.tokenId || !sessionData?.userId) {
      throw new Error(`Invalid session data: ${sessionId}`);
    }

    // Get user data
    const userDoc = await sessionData.userId.get();

    if (!userDoc.exists) {
      return {
        result: { $case: "rejected", rejected: { message: "User not found" } },
      };
    }

    const userData = userDoc.data() as UserEntity;

    const tokenIdHex = sessionData.tokenId.id;

    // Generate authorization key
    const authorizationKey = diversifyKey(
      options.masterKey,
      options.systemName,
      Buffer.from(tokenIdHex, "hex"),
      "authorization"
    );

    // Verify step 2 of mutual authentication
    authorizeStep2(
      Buffer.from(request.encryptedNtagResponse),
      toKeyBytes(authorizationKey),
      sessionData.rndA
    );

    // Authentication successful - no need to update session as it's already properly created
    // Just return the TokenSession response

    const tokenId: TagUid = {
      uid: new Uint8Array(Buffer.from(tokenIdHex, "hex")),
    };

    const session: TokenSession = {
      tokenId,
      sessionId,
      expiration: BigInt(Math.floor(Date.now() / 1000) + 24 * 60 * 60), // 24 hours from now in seconds
      userId: userDoc.id,
      userLabel: userData?.displayName || "Unknown User",
      permissions: userData.permissions.map((p) => p.id),
    };

    logger.info("Authentication completed successfully", {
      sessionId,
      userId: userDoc.id,
    });

    return {
      result: { $case: "session", session },
    };
  } catch (error) {
    logger.error("Authentication failed", { sessionId, error });

    return {
      result: {
        $case: "rejected",
        rejected: {
          message:
            error instanceof Error ? error.message : "Authentication failed",
        },
      },
    };
  }
}
