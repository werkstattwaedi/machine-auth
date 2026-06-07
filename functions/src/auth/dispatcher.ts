// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `authCall` — grouped callable for the auth/account domain (#277).
 * Routes to createUser / requestLoginCode / verifyLoginCode / verifyMagicLink.
 */

import { onCall } from "firebase-functions/v2/https";
import { dispatchRpc, type RpcHandler } from "../rpc/dispatch";
import { resendApiKey } from "../util/resend_template";
import {
  terminalKey,
  diversificationMasterKey,
} from "../config/tag-secrets";
import { createUserHandler } from "./create-user";
import { requestLoginCodeHandler } from "./login-code/request";
import { verifyLoginCodeHandler } from "./login-code/verify-code";
import { verifyMagicLinkHandler } from "./login-code/verify-link";
import { resolveTagHandler } from "./resolve-tag";

const HANDLERS: Record<string, RpcHandler> = {
  createUser: createUserHandler,
  requestLoginCode: requestLoginCodeHandler,
  verifyLoginCode: verifyLoginCodeHandler,
  verifyMagicLink: verifyMagicLinkHandler,
  resolveTag: resolveTagHandler,
};

export const authCall = onCall(
  {
    // resendApiKey: login-code emails. terminalKey + master key: resolveTag
    // decrypts the tapped tag's PICC. DIVERSIFICATION_SYSTEM_NAME is a
    // defineString param (not a secret), so it needs no entry here.
    secrets: [resendApiKey, terminalKey, diversificationMasterKey],
    memory: "512MiB",
  },
  (request) => dispatchRpc("auth", HANDLERS, request)
);
