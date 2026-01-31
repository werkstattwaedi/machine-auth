// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  TerminalCheckinRequest,
  TerminalCheckinResponse,
} from "../proto/firebase_rpc/auth.js";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { TokenEntity, UserEntity } from "../types/firestore_entities";

// Auth reuse window in milliseconds (5 minutes)
const AUTH_REUSE_WINDOW_MS = 5 * 60 * 1000;

export async function handleTerminalCheckin(
  request: TerminalCheckinRequest,
  _options: {
    masterKey: string;
    systemName: string;
  }
): Promise<TerminalCheckinResponse> {
  logger.info("Terminal checkin", { tokenId: request.tokenId });

  if (!request.tokenId?.value || request.tokenId.value.length === 0) {
    return {
      result: { $case: "rejected", rejected: { message: "Missing token ID" } },
    };
  }

  const uid = Buffer.from(request.tokenId.value);
  const tokenIdHex = uid.toString("hex");

  try {
    // Look up token directly by document ID
    const tokenDoc = await admin
      .firestore()
      .collection("tokens")
      .doc(tokenIdHex)
      .get();

    if (!tokenDoc.exists) {
      logger.warn("Token not found", { tokenId: tokenIdHex });
      return {
        result: { $case: "rejected", rejected: { message: "Token not registered" } },
      };
    }

    const tokenData = tokenDoc.data() as TokenEntity;
    if (!tokenData) {
      return {
        result: { $case: "rejected", rejected: { message: "Invalid token data" } },
      };
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
      return {
        result: { $case: "rejected", rejected: { message: "User not found" } },
      };
    }
    const userData = userDoc.data() as UserEntity;

    // TODO: Check machine permissions here if machine ID is provided
    // For now, we just return the user info

    // Check for recent completed authentication that can be reused
    const reuseCutoff = new Date(Date.now() - AUTH_REUSE_WINDOW_MS);
    const recentAuthQuery = await admin
      .firestore()
      .collection("authentications")
      .where("tokenId", "==", tokenDoc.ref)
      .where("inProgressAuth", "==", null) // Only completed auths
      .where("created", ">=", reuseCutoff)
      .orderBy("created", "desc")
      .limit(1)
      .get();

    let authenticationId: string | undefined;
    if (!recentAuthQuery.empty) {
      authenticationId = recentAuthQuery.docs[0].id;
      logger.info("Reusing recent authentication", { authenticationId });
    }

    logger.info("Terminal checkin successful", {
      userId: userDoc.id,
      hasExistingAuth: !!authenticationId,
    });

    return {
      result: {
        $case: "authorized",
        authorized: {
          userId: { value: userDoc.id },
          userLabel: userData.displayName || "Unknown User",
          authenticationId: authenticationId ? { value: authenticationId } : undefined,
        },
      },
    };
  } catch (error) {
    logger.error("Terminal checkin failed", { error });
    return {
      result: {
        $case: "rejected",
        rejected: {
          message: error instanceof Error ? error.message : "Internal error",
        },
      },
    };
  }
}
