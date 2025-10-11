import {
  CompleteAuthenticationRequestT,
  CompleteAuthenticationResponseT,
  CompleteAuthenticationResult,
  RejectedT,
  TokenSessionT,
  TagUidT,
} from "../fbs";
import * as logger from "firebase-functions/logger";
import { authorizeStep2 } from "../ntag/authorize";
import { diversifyKey } from "../ntag/key_diversification";
import { toKeyBytes } from "../ntag/bytebuffer_util";
import * as admin from "firebase-admin";
import { SessionEntity, UserEntity } from "../types/firestore_entities";

export async function handleCompleteAuthentication(
  request: CompleteAuthenticationRequestT,
  options: {
    masterKey: string;
    systemName: string;
  }
): Promise<CompleteAuthenticationResponseT> {
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

    const userId = sessionData.userId.id;

    // Get user data
    const userDoc = await admin
      .firestore()
      .collection("users")
      .doc(userId)
      .get();

    if (!userDoc.exists) {
      const rejected = new RejectedT();
      rejected.message = "User not found";

      const response = new CompleteAuthenticationResponseT();
      response.resultType = CompleteAuthenticationResult.Rejected;
      response.result = rejected;
      return response;
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

    // Create TokenSession response
    const tagUid = new TagUidT();
    tagUid.uid = Array.from(Buffer.from(tokenIdHex, "hex"));

    const tokenSession = new TokenSessionT();
    tokenSession.tokenId = tagUid;
    tokenSession.sessionId = sessionId;
    tokenSession.expiration = BigInt(
      Math.floor(Date.now() / 1000) + 24 * 60 * 60
    ); // 24 hours from now in seconds
    tokenSession.userId = userDoc.id;
    tokenSession.userLabel = userData?.displayName || "Unknown User";

    // Extract permission IDs from DocumentReferences
    // Permissions are stored as DocumentReferences in Firestore
    // We extract just the ID for the flatbuffer response
    tokenSession.permissions = userData.permissions.map(p => p.id);

    const response = new CompleteAuthenticationResponseT();
    response.resultType = CompleteAuthenticationResult.TokenSession;
    response.result = tokenSession;

    logger.info("Authentication completed successfully", {
      sessionId,
      userId: userDoc.id,
    });

    return response;
  } catch (error) {
    logger.error("Authentication failed", { sessionId, error });

    const rejected = new RejectedT();
    rejected.message =
      error instanceof Error ? error.message : "Authentication failed";

    const response = new CompleteAuthenticationResponseT();
    response.resultType = CompleteAuthenticationResult.Rejected;
    response.result = rejected;
    return response;
  }
}
