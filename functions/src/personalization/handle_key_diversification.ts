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
    !req.tokenId.value ||
    req.tokenId.value.length !== 7
  ) {
    throw new Error("Invalid or missing tag UID");
  }
  const uidHex = Buffer.from(req.tokenId.value).toString("hex");
  const keys = diversifyKeys(config.masterKey, config.systemName, uidHex);

  return {
    applicationKey: { value: new Uint8Array(Buffer.from(keys.application, "hex")) },
    authorizationKey: { value: new Uint8Array(Buffer.from(keys.authorization, "hex")) },
    sdmMacKey: { value: new Uint8Array(Buffer.from(keys.sdm_mac, "hex")) },
    reserved2Key: { value: new Uint8Array(Buffer.from(keys.reserved2, "hex")) },
  };
}
