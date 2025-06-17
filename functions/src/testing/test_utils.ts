import * as flatbuffers from "flatbuffers";
import { StartSessionRequestT } from "../fbs/oww/session/start-session-request";
import { TagUidT } from "../fbs/oww/ntag/tag-uid";
import { Authentication } from "../fbs/oww/session/authentication";
import { FirstAuthenticationT } from "../fbs/oww/session/first-authentication";

export function generateEncodedStartSessionRequest(
  machineId: string,
  tokenId: number[],
  challenge: number[]
): string {
  const builder = new flatbuffers.Builder(1024);

  const tagUid = new TagUidT(tokenId);
  const firstAuth = new FirstAuthenticationT(challenge);

  const startSessionRequest = new StartSessionRequestT(
    tagUid,
    machineId,
    Authentication.FirstAuthentication,
    firstAuth
  );

  const requestOffset = startSessionRequest.pack(builder);
  builder.finish(requestOffset);
  const responseBytes = builder.asUint8Array();
  return Buffer.from(responseBytes).toString("base64");
}
