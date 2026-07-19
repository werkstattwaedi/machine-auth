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
  kioskBearerKey,
} from "../config/tag-secrets";
import { createUserHandler } from "./create-user";
import {
  checkAccountExistsHandler,
  checkPhoneAccountExistsHandler,
} from "./check-account-exists";
import { requestLoginCodeHandler } from "./login-code/request";
import { verifyLoginCodeHandler } from "./login-code/verify-code";
import { verifyMagicLinkHandler } from "./login-code/verify-link";
import { resolveTagHandler } from "./resolve-tag";
import { verifyTagCheckoutHandler } from "../checkout/verify_tag";
import { verifyLoginCodeKioskHandler } from "../checkout/verify_login_code_kiosk";
import { exchangeKioskSessionHandler } from "../checkout/exchange_kiosk_session";
import { probeTagHandler } from "../checkout/probe_tag";
import { privacyReportHandler } from "../privacy/privacy_report";
import { privacyEraseHandler } from "../privacy/erase_subject";
import { privacyTrimHandler } from "../privacy/trim";
import { statsSubjectSalt } from "../privacy/subject_key";

const HANDLERS: Record<string, RpcHandler> = {
  createUser: createUserHandler,
  checkAccountExists: checkAccountExistsHandler,
  checkPhoneAccountExists: checkPhoneAccountExistsHandler,
  requestLoginCode: requestLoginCodeHandler,
  verifyLoginCode: verifyLoginCodeHandler,
  verifyLoginCodeKiosk: verifyLoginCodeKioskHandler,
  exchangeKioskSession: exchangeKioskSessionHandler,
  verifyMagicLink: verifyMagicLinkHandler,
  resolveTag: resolveTagHandler,
  verifyTagCheckout: verifyTagCheckoutHandler,
  probeTag: probeTagHandler,
  // Admin-only DSAR tooling (ADR-0038). Deliberately grouped here rather
  // than a fifth dispatcher: traffic is rare, and sharing authCall's warm
  // instance beats a dedicated cold container.
  privacyReport: privacyReportHandler,
  privacyErase: privacyEraseHandler,
  privacyTrim: privacyTrimHandler,
};

export const authCall = onCall(
  {
    // resendApiKey: login-code emails. terminalKey + master key: resolveTag +
    // verifyTagCheckout decrypt the tapped tag's PICC. kioskBearerKey: soft
    // gate for verifyTagCheckout. statsSubjectSalt: privacyErase's
    // flush-before-delete builds stats rows (ADR-0038/0039).
    // DIVERSIFICATION_SYSTEM_NAME is a defineString param (not a secret),
    // so it needs no entry here.
    secrets: [
      resendApiKey,
      terminalKey,
      diversificationMasterKey,
      kioskBearerKey,
      statsSubjectSalt,
    ],
    memory: "512MiB",
    // privacyErase/privacyTrim scan + batch-delete a subject's whole graph;
    // the callable default of 60s is too tight for a heavy subject. Login
    // traffic is unaffected by a higher cap.
    timeoutSeconds: 300,
  },
  (request) => dispatchRpc("auth", HANDLERS, request)
);
