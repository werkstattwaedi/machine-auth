// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  CompleteTagAuthRequest,
  CompleteTagAuthResponse,
} from "../proto/firebase_rpc/auth.js";
import { Key } from "../proto/common.js";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { diversifyKey, KeyName } from "../ntag/key_diversification";
import { authorizeStep2 } from "../ntag/authorize";
import { toKeyBytes } from "../ntag/bytebuffer_util";
import { deriveSessionKeys } from "../ntag/session_key_derivation";
import { AuthenticationEntity } from "../types/firestore_entities";

// Map key slot enum to diversification key name
function getKeyName(keySlot: Key): KeyName {
  switch (keySlot) {
    case Key.KEY_APPLICATION:
      return "application";
    case Key.KEY_TERMINAL:
      return "terminal";
    case Key.KEY_AUTHORIZATION:
      return "authorization";
    default:
      throw new Error(`Unsupported key slot: ${keySlot}`);
  }
}

export async function handleCompleteTagAuth(
  request: CompleteTagAuthRequest,
  options: {
    masterKey: string;
    systemName: string;
  }
): Promise<CompleteTagAuthResponse> {
  logger.info("Completing tag authentication", { authId: request.authId });

  if (!request.authId?.value) {
    return {
      result: { $case: "rejected", rejected: { message: "Missing auth ID" } },
    };
  }

  if (
    !request.encryptedTagResponse ||
    request.encryptedTagResponse.length === 0
  ) {
    return {
      result: {
        $case: "rejected",
        rejected: { message: "Missing encrypted tag response" },
      },
    };
  }

  if (request.encryptedTagResponse.length !== 32) {
    return {
      result: {
        $case: "rejected",
        rejected: { message: "Encrypted tag response must be 32 bytes" },
      },
    };
  }

  const authId = request.authId.value;

  try {
    // Get authentication record
    const authDoc = await admin
      .firestore()
      .collection("authentications")
      .doc(authId)
      .get();

    if (!authDoc.exists) {
      return {
        result: {
          $case: "rejected",
          rejected: { message: "Authentication not found" },
        },
      };
    }

    const authData = authDoc.data() as AuthenticationEntity;
    if (!authData?.inProgressAuth) {
      return {
        result: {
          $case: "rejected",
          rejected: { message: "Authentication already completed or expired" },
        },
      };
    }

    const { rndA, rndB } = authData.inProgressAuth;
    if (!rndA || !rndB) {
      return {
        result: {
          $case: "rejected",
          rejected: { message: "Invalid authentication state" },
        },
      };
    }

    // Get the token ID for key derivation
    const tokenIdHex = authData.tokenId.id;
    const uid = Buffer.from(tokenIdHex, "hex");

    // Get the key name for diversification
    const keyName = getKeyName(authData.keySlot as Key);

    // Generate the appropriate key
    const authKey = diversifyKey(
      options.masterKey,
      options.systemName,
      uid,
      keyName
    );
    const authKeyBytes = toKeyBytes(authKey);

    // Verify step 2 of mutual authentication
    const { ti, pdCap2 } = authorizeStep2(
      Buffer.from(request.encryptedTagResponse),
      authKeyBytes,
      Buffer.from(rndA)
    );

    // Derive session keys
    const { sesAuthEncKey, sesAuthMacKey } = deriveSessionKeys(
      authKeyBytes,
      Buffer.from(rndA),
      Buffer.from(rndB)
    );

    // Clear the crypto state (auth is now complete)
    await admin
      .firestore()
      .collection("authentications")
      .doc(authId)
      .update({
        inProgressAuth: null,
      });

    logger.info("Tag authentication completed successfully", {
      authId,
      tokenIdHex,
    });

    return {
      result: {
        $case: "sessionKeys",
        sessionKeys: {
          sesAuthEncKey: new Uint8Array(sesAuthEncKey),
          sesAuthMacKey: new Uint8Array(sesAuthMacKey),
          transactionIdentifier: new Uint8Array(ti),
          piccCapabilities: new Uint8Array(pdCap2),
        },
      },
    };
  } catch (error) {
    logger.error("Tag authentication failed", { authId, error });

    // Delete the authentication record on failure
    try {
      await admin
        .firestore()
        .collection("authentications")
        .doc(authId)
        .delete();
    } catch (deleteError) {
      logger.warn("Failed to delete authentication record", { authId });
    }

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
