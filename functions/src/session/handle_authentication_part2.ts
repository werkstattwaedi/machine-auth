import { logger } from "firebase-functions";
import { AuthenticatePart2RequestT, AuthenticatePart2ResponseT } from "../fbs/oww/session";

export function handleAuthenticatePart2(
  request: AuthenticatePart2RequestT,
  options: {
    masterKey: string;
    systemName: string;
  }
): AuthenticatePart2ResponseT {

   logger.info("handleStartSession", request);
    if (!request.sessionId) {
      throw new Error("Missing sessionId");
    }
    
    
    // const uid = Buffer.from(request.tokenId.uid);
  
    const response = new AuthenticatePart2ResponseT();

    return response;
}
