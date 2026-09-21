// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Resolve the email recipient for a checkout.
 *
 * Two resolvers live here on purpose (issue #651):
 * - `resolveRecipientEmail` — account holder only. Used by the
 *   stale-checkout reminder cron, whose `/checkout/<id>` link requires a
 *   sign-in, so anonymous (guest) checkouts must stay out of it.
 * - `resolveBillRecipientEmail` — account holder, else the guest's own
 *   e-mail. Used by the bill mails (invoice / Beleg / cancellation).
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

/**
 * The e-mail a walk-in guest typed at check-in (issue #651).
 *
 * A guest checkout has no account holder (`userId` null) and the only
 * e-mail we hold is the one on the roster. Picks the first `persons[]`
 * entry with a non-empty e-mail. Returns `null` when the checkout HAS an
 * account holder: per ADR-0029 / #471 a roster member is never mailed
 * instead of the payer, so the fallback must not leak into that case.
 *
 * `CheckoutEntity.userId` is typed non-nullable but is `null` in practice
 * for anonymous checkouts (the web `CheckoutDoc` type has it right).
 *
 * Exported for unit testing.
 */
export function resolveGuestEmail(checkout: CheckoutEntity): string | null {
  if (checkout.userId) return null;
  for (const person of checkout.persons ?? []) {
    const email = person.email?.trim();
    if (email) return email;
  }
  return null;
}

/**
 * Recipient for bill mails: the account holder when there is one (#471),
 * otherwise the guest's own e-mail (#651). Returns `null` when neither
 * resolves — callers mark the bill `emailSkippedReason: "no-recipient"`.
 */
export async function resolveBillRecipientEmail(
  checkout: CheckoutEntity,
): Promise<string | null> {
  return (await resolveRecipientEmail(checkout)) ?? resolveGuestEmail(checkout);
}
