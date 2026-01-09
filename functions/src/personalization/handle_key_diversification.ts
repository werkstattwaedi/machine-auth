import {
  KeyDiversificationRequest,
  KeyDiversificationResponse,
} from "../proto/firebase_rpc/personalization.js";
import { diversifyKeys } from "../ntag/key_diversification";

/**
 * Handles a KeyDiversificationRequest and returns a KeyDiversificationResponse.
 * @param req The unpacked KeyDiversificationRequest
 * @param config The config object containing masterKey and systemName
 */
export function handleKeyDiversification(
  req: KeyDiversificationRequest,
  config: { masterKey: string; systemName: string }
): KeyDiversificationResponse {
  if (
    !req.tokenId ||
    !req.tokenId.uid ||
    req.tokenId.uid.length !== 7
  ) {
    throw new Error("Invalid or missing tag UID");
  }
  const uidHex = Buffer.from(req.tokenId.uid).toString("hex");
  const keys = diversifyKeys(config.masterKey, config.systemName, uidHex);

  return {
    applicationKey: { key: new Uint8Array(Buffer.from(keys.application, "hex")) },
    authorizationKey: { key: new Uint8Array(Buffer.from(keys.authorization, "hex")) },
    reserved1Key: { key: new Uint8Array(Buffer.from(keys.reserved1, "hex")) },
    reserved2Key: { key: new Uint8Array(Buffer.from(keys.reserved2, "hex")) },
  };
}
