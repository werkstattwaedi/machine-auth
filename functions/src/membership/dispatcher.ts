// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `membershipCall` — grouped callable for the membership domain (#277).
 * Routes purchase / invite / accept / reject / revoke / remove / createChild /
 * cancel / cancelAutoRenew and the two admin operations.
 */

import { onCall } from "firebase-functions/v2/https";
import { dispatchRpc, type RpcHandler } from "../rpc/dispatch";
import { resendApiKey } from "../util/resend_template";
import { purchaseMembershipHandler } from "./purchase";
import { inviteFamilyMemberHandler } from "./invite";
import { acceptFamilyInviteHandler } from "./accept_invite";
import { rejectFamilyInviteHandler } from "./reject_invite";
import { revokeFamilyInviteHandler } from "./revoke_invite";
import { removeFamilyMemberHandler } from "./remove";
import { createChildAccountHandler } from "./create_child";
import { cancelMembershipHandler } from "./cancel";
import { cancelMembershipAutoRenewHandler } from "./cancel_auto_renew";
import {
  adminCreateMembershipHandler,
  adminExtendMembershipHandler,
} from "./admin";

const HANDLERS: Record<string, RpcHandler> = {
  purchaseMembership: purchaseMembershipHandler,
  inviteFamilyMember: inviteFamilyMemberHandler,
  acceptFamilyInvite: acceptFamilyInviteHandler,
  rejectFamilyInvite: rejectFamilyInviteHandler,
  revokeFamilyInvite: revokeFamilyInviteHandler,
  removeFamilyMember: removeFamilyMemberHandler,
  createChildAccount: createChildAccountHandler,
  cancelMembership: cancelMembershipHandler,
  cancelMembershipAutoRenew: cancelMembershipAutoRenewHandler,
  adminCreateMembership: adminCreateMembershipHandler,
  adminExtendMembership: adminExtendMembershipHandler,
};

export const membershipCall = onCall(
  { secrets: [resendApiKey], memory: "512MiB" },
  (request) => dispatchRpc("membership", HANDLERS, request)
);
