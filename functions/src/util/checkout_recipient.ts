// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Resolve the email recipient for a checkout — always the account holder.
 *
 * Lives in its own module (rather than `invoice/bill_triggers.ts`) so callers
 * that only need the recipient — e.g. the stale-checkout reminder cron (#531)
 * — don't drag the invoice PDF stack (pdfkit, storage) into their cold-start
 * bundle. `bill_triggers.ts` re-exports it to preserve its public surface.
 */

import * as logger from "firebase-functions/logger";
import type {
  CheckoutEntity,
  UserEntity,
} from "../types/firestore_entities";

/**
 * Resolve the invoice/reminder-email recipient for a checkout (issue #471).
 *
 * The mail always goes to the checkout's account holder (`checkout.userId`) —
 * the payer — and to no one else, regardless of who appears on the roster
 * (`persons`). Per ADR-0029 (#439), account-less family members exist only as
 * roster members of a family whose owner is the payer; they never have an
 * email of their own. So even when the owner has removed themselves from
 * `persons` and only an account-less child remains, the recipient is
 * unambiguous: the account holder's email.
 *
 * Returns `null` (caller logs + skips) when the checkout has no account holder
 * (anonymous checkout) or the account holder has no email (child account).
 *
 * Exported for unit testing.
 */
export async function resolveRecipientEmail(
  checkout: CheckoutEntity,
): Promise<string | null> {
  if (!checkout.userId) return null;
  try {
    const ownerSnap = await checkout.userId.get();
    return (ownerSnap.data() as UserEntity | undefined)?.email || null;
  } catch (error) {
    // Fail soft: an account-holder lookup hiccup shouldn't crash the send
    // path — skip rather than throw.
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `resolveRecipientEmail: account-holder lookup failed for ${checkout.userId.path}`,
      { error: message },
    );
    return null;
  }
}
