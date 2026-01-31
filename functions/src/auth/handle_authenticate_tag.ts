// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  AuthenticateTagRequest,
  AuthenticateTagResponse,
} from "../proto/firebase_rpc/auth.js";
import { Key } from "../proto/common.js";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { diversifyKey, KeyName } from "../ntag/key_diversification";
import { authorizeStep1 } from "../ntag/authorize";
import { toKeyBytes } from "../ntag/bytebuffer_util";
import { TokenEntity } from "../types/firestore_entities";

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

export async function handleAuthenticateTag(
  request: AuthenticateTagRequest,
  options: {
    masterKey: string;
    systemName: string;
  }
): Promise<AuthenticateTagResponse> {
  logger.info("Authenticating tag", {
    tagId: request.tagId,
    keySlot: request.keySlot,
  });

  if (!request.tagId?.value || request.tagId.value.length === 0) {
    throw new Error("Missing tag ID");
  }

  if (!request.ntagChallenge || request.ntagChallenge.length === 0) {
    throw new Error("Missing ntag challenge");
  }

  if (request.ntagChallenge.length !== 16) {
    throw new Error("ntag challenge must be 16 bytes");
  }

  const uid = Buffer.from(request.tagId.value);
  const tokenIdHex = uid.toString("hex");

  // Look up token to verify it exists
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

  // Get the key name for diversification
  const keyName = getKeyName(request.keySlot);

  // Generate the appropriate key
  const authKey = diversifyKey(
    options.masterKey,
    options.systemName,
    uid,
    keyName
  );

  // Perform step 1 of mutual authentication
  const challengeResponse = authorizeStep1(
    Buffer.from(request.ntagChallenge),
    toKeyBytes(authKey)
  );

  // Create authentication record with crypto state
  const authId = admin.firestore().collection("authentications").doc().id;
  await admin.firestore().collection("authentications").doc(authId).set({
    tokenId: tokenDoc.ref,
    keySlot: request.keySlot,
    created: Timestamp.now(),
    inProgressAuth: {
      rndA: challengeResponse.cloudChallenge,
      rndB: challengeResponse.rndB,
    },
  });

  logger.info("Authentication initiated", { authId, tokenIdHex });

  return {
    authId: { value: authId },
    cloudChallenge: new Uint8Array(challengeResponse.encrypted),
  };
}
