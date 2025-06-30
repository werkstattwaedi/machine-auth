import { KeyDiversificationRequestT } from "../fbs/oww/personalization/key-diversification-request";
import { KeyDiversificationResponseT } from "../fbs/oww/personalization/key-diversification-response";
import { KeyBytesT } from "../fbs/oww/ntag/key-bytes";
import { diversifyKeys } from "../ntag/key_diversification";

/**
 * Handles a KeyDiversificationRequest and returns a KeyDiversificationResponseT.
 * @param req The unpacked KeyDiversificationRequestT
 * @param config The config object containing masterKey and systemName
 */
export function handleKeyDiversification(
  req: KeyDiversificationRequestT,
  config: { masterKey: string; systemName: string }
): KeyDiversificationResponseT {
  if (
    !req.tokenId ||
    !Array.isArray(req.tokenId.uid) ||
    req.tokenId.uid.length !== 7
  ) {
    throw new Error("Invalid or missing tag UID");
  }
  const uidHex = Buffer.from(req.tokenId.uid).toString("hex");
  const keys = diversifyKeys(config.masterKey, config.systemName, uidHex);

  return new KeyDiversificationResponseT(
    new KeyBytesT(Array.from(Buffer.from(keys.application, "hex"))),
    new KeyBytesT(Array.from(Buffer.from(keys.authorization, "hex"))),
    new KeyBytesT(Array.from(Buffer.from(keys.reserved1, "hex"))),
    new KeyBytesT(Array.from(Buffer.from(keys.reserved2, "hex")))
  );
}
