// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  RejectionReason,
  TerminalCheckinRequest,
  TerminalCheckinResponse,
} from "../proto/firebase_rpc/auth.js";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {
  CheckoutEntity,
  MachineEntity,
  TokenEntity,
  UserEntity,
} from "../types/firestore_entities";
import { formatFullName } from "../util/username-utils";
import { isSameBusinessDay, rejectionCause } from "@oww/shared";
import { resolveCheckoutDomain } from "../util/checkout-domain";
import { buildDeniedUrl, zurichDateKey } from "./denied_url";

// Auth reuse window in milliseconds (5 minutes)
const AUTH_REUSE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Build a rejected response. The `reason` is machine-readable so the terminal
 * can branch on layout (issue #535); `actionUrl` is the QR deep link to the
 * `/denied` landing page (empty when there is nothing actionable).
 */
function rejected(
  message: string,
  reason: RejectionReason = RejectionReason.REJECTION_REASON_UNSPECIFIED,
  actionUrl = ""
): TerminalCheckinResponse {
  return {
    result: { $case: "rejected", rejected: { message, reason, actionUrl } },
  };
}

/**
 * Build the `/denied` deep link, tolerating a misconfigured CHECKOUT_DOMAIN:
 * we would rather still deny with a clear reason + message and drop the QR
 * link than turn the denial into a generic internal error. The domain misconfig
 * is logged loudly by `resolveCheckoutDomain` for ops.
 */
function deniedUrlSafe(
  cause: ReturnType<typeof rejectionCause>,
  uid: string,
  extra: { checkoutId?: string; since?: string } = {}
): string {
  try {
    return buildDeniedUrl(resolveCheckoutDomain(), { cause, uid, ...extra });
  } catch (error) {
    logger.error("Could not build /denied action URL", { error });
    return "";
  }
}

/**
 * Terminal check-in. Validates token + user, then enforces
 * `machine.requiredPermission`: the user must hold every permission listed
 * on the target machine (AND semantics). Empty/missing requiredPermission
 * means the machine is unrestricted. The terminal must include `machineId`
 * in the request — there is no implicit allow-anything path.
 */
export async function handleTerminalCheckin(
  request: TerminalCheckinRequest,
  _options: {
    masterKey: string;
    systemName: string;
  }
): Promise<TerminalCheckinResponse> {
  logger.info("Terminal checkin", {
    tokenId: request.tokenId,
    machineId: request.machineId?.value,
  });

  if (!request.tokenId?.value || request.tokenId.value.length === 0) {
    return rejected("Missing token ID");
  }

  if (!request.machineId?.value) {
    return rejected("Missing machine ID");
  }

  const uid = Buffer.from(request.tokenId.value);
  const tokenIdHex = uid.toString("hex");
  const machineId = request.machineId.value;

  try {
    // Look up token directly by document ID
    const tokenDoc = await admin
      .firestore()
      .collection("tokens")
      .doc(tokenIdHex)
      .get();

    if (!tokenDoc.exists) {
      logger.warn("Token not found", { tokenId: tokenIdHex });
      return rejected(
        "Token not registered",
        RejectionReason.REJECTION_REASON_TOKEN_UNKNOWN
      );
    }

    const tokenData = tokenDoc.data() as TokenEntity;
    if (!tokenData) {
      return rejected("Invalid token data");
    }

    // Check if token is deactivated
    if (tokenData.deactivated) {
      logger.warn("Token is deactivated", { tokenId: tokenIdHex });
      return rejected(
        "Token deactivated",
        RejectionReason.REJECTION_REASON_TOKEN_DEACTIVATED
      );
    }

    // Get user data
    const userDoc = await tokenData.userId.get();
    if (!userDoc.exists) {
      return rejected("User not found");
    }
    const userData = userDoc.data() as UserEntity;

    // Enforce machine.requiredPermission. AND semantics: user must hold every
    // listed permission. Empty/missing requiredPermission = unrestricted.
    const machineDoc = await admin
      .firestore()
      .collection("machine")
      .doc(machineId)
      .get();
    if (!machineDoc.exists) {
      logger.warn("Machine not found", { machineId });
      return rejected("Maschine nicht gefunden");
    }
    const machineData = machineDoc.data() as MachineEntity;
    const requiredPermission = machineData.requiredPermission ?? [];
    if (requiredPermission.length > 0) {
      const userPermissionPaths = new Set(
        (userData.permissions ?? []).map((ref) => ref.path)
      );
      const missing = requiredPermission
        .map((ref) => ref.path)
        .filter((path) => !userPermissionPaths.has(path));
      if (missing.length > 0) {
        logger.warn("User missing required permission for machine", {
          userId: userDoc.id,
          machineId,
          missing,
        });
        return rejected(
          "Keine Berechtigung für diese Maschine",
          RejectionReason.REJECTION_REASON_MISSING_PERMISSION,
          deniedUrlSafe(
            rejectionCause(RejectionReason.REJECTION_REASON_MISSING_PERMISSION),
            userDoc.id
          )
        );
      }
    }

    // Prior-business-day open-checkout gate (issue #393).
    //
    // The web checkout UI shows a red "Offener Besuch vom …" banner when a
    // user has an open checkout left over from a previous business day, but
    // that banner is purely cosmetic — it never blocked the machine token-auth
    // path. So a badge-in was authorized even with a stale open checkout. Add
    // the server-side gate here: deny badge-in if any of the user's open
    // checkouts was created on an earlier business day than now.
    //
    // "Business day" uses the shared 03:00 Europe/Zurich boundary helper
    // (`isSameBusinessDay` from @oww/shared, issue #268) so the terminal and
    // the web banner agree on what counts as "yesterday's" visit. Same-day
    // open checkouts and users without any open checkout are unaffected.
    const now = new Date();
    const openCheckoutsQuery = await admin
      .firestore()
      .collection("checkouts")
      .where("userId", "==", userDoc.ref)
      .where("status", "==", "open")
      .get();

    const staleCheckout = openCheckoutsQuery.docs.find((doc) => {
      const checkout = doc.data() as CheckoutEntity;
      const created = checkout.created?.toDate();
      // Missing `created` is treated as stale to fail safe: an open checkout
      // we cannot date should not silently authorize a new badge-in.
      return !created || !isSameBusinessDay(created, now);
    });

    if (staleCheckout) {
      logger.warn("User has a stale open checkout from a prior business day", {
        userId: userDoc.id,
        machineId,
      });
      // The offending checkout's created date drives both the human message
      // (de-CH date) and the /denied deep link (`since` machine token). A
      // missing `created` (the fail-safe branch above) leaves both date-less.
      const created = (
        staleCheckout.data() as CheckoutEntity
      ).created?.toDate();
      const dateLabel = created
        ? new Intl.DateTimeFormat("de-CH", {
            timeZone: "Europe/Zurich",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }).format(created)
        : undefined;
      const message = dateLabel
        ? `Schliesse deinen letzten Besuch vom ${dateLabel} ab, bevor du die Maschinen heute nutzt.`
        : "Schliesse deinen letzten Besuch ab, bevor du die Maschinen heute nutzt.";
      return rejected(
        message,
        RejectionReason.REJECTION_REASON_STALE_CHECKOUT,
        deniedUrlSafe(
          rejectionCause(RejectionReason.REJECTION_REASON_STALE_CHECKOUT),
          userDoc.id,
          {
            checkoutId: staleCheckout.id,
            since: created ? zurichDateKey(created) : undefined,
          }
        )
      );
    }

    // Check for recent completed authentication that can be reused
    const reuseCutoff = new Date(Date.now() - AUTH_REUSE_WINDOW_MS);
    const recentAuthQuery = await admin
      .firestore()
      .collection("authentications")
      .where("tokenId", "==", tokenDoc.ref)
      .where("inProgressAuth", "==", null) // Only completed auths
      .where("created", ">=", reuseCutoff)
      .orderBy("created", "desc")
      .limit(1)
      .get();

    let authenticationId: string | undefined;
    if (!recentAuthQuery.empty) {
      authenticationId = recentAuthQuery.docs[0].id;
      logger.info("Reusing recent authentication", { authenticationId });
    }

    logger.info("Terminal checkin successful", {
      userId: userDoc.id,
      hasExistingAuth: !!authenticationId,
    });

    return {
      result: {
        $case: "authorized",
        authorized: {
          userId: { value: userDoc.id },
          userLabel: formatFullName(userData, "Unknown User"),
          authenticationId: authenticationId ? { value: authenticationId } : undefined,
        },
      },
    };
  } catch (error) {
    logger.error("Terminal checkin failed", { error });
    return rejected(
      error instanceof Error ? error.message : "Internal error"
    );
  }
}
