// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `authCall` — grouped callable for the auth/account domain (#277).
 * Routes to createUser / requestLoginCode / verifyLoginCode / verifyMagicLink.
 */

import { onCall } from "firebase-functions/v2/https";
import { dispatchRpc, type RpcHandler } from "../rpc/dispatch";
import { resendApiKey } from "../util/resend_template";
import { createUserHandler } from "./create-user";
import { requestLoginCodeHandler } from "./login-code/request";
import { verifyLoginCodeHandler } from "./login-code/verify-code";
import { verifyMagicLinkHandler } from "./login-code/verify-link";

const HANDLERS: Record<string, RpcHandler> = {
  createUser: createUserHandler,
  requestLoginCode: requestLoginCodeHandler,
  verifyLoginCode: verifyLoginCodeHandler,
  verifyMagicLink: verifyMagicLinkHandler,
};

export const authCall = onCall(
  { secrets: [resendApiKey], memory: "512MiB" },
  (request) => dispatchRpc("auth", HANDLERS, request)
);
