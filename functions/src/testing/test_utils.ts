import * as flatbuffers from "flatbuffers";
import { AuthenticateNewSessionRequestT, TagUidT } from "../fbs";

export function generateEncodedStartSessionRequest(
  tokenId: number[],
  challenge: number[]
): string {
  const builder = new flatbuffers.Builder(1024);

  const tagUid = new TagUidT(tokenId);

  const startSessionRequest = new AuthenticateNewSessionRequestT(
    tagUid,
    challenge
  );

  const requestOffset = startSessionRequest.pack(builder);
  builder.finish(requestOffset);
  const responseBytes = builder.asUint8Array();
  return Buffer.from(responseBytes).toString("base64");
}
