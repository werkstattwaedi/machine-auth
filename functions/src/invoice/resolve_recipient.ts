// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Recipient block resolution for the invoice PDF (issues #269, #658).
 *
 * Until #741 the close path dropped every `persons[].userRef`, so resolving
 * the recipient through it (the original #269 approach) silently found
 * nothing and every invoice shipped without a recipient block (#658), and
 * closed checkouts from before the fix still lack them. The account holder
 * is taken from `bill.userId` / `checkout.userId`, which the close path
 * always records — never from a roster line: on an ownerless (eager-anon)
 * checkout the roster is writable by the anonymous session, so a
 * `persons[0].userRef` would let it pull someone else's name and address
 * onto its invoice.
 *
 * `pickRecipient` is pure so the resolution order is unit-testable;
 * `loadRecipient` wraps the single user-doc read around it.
 */

import * as logger from "firebase-functions/logger";
import type { DocumentReference } from "firebase-admin/firestore";
import type {
  BillingAddress,
  CheckoutEntity,
  CheckoutPersonEntity,
  UserEntity,
} from "../types/firestore_entities";
import { formatFullName } from "../util/username-utils";

/** The subset of the account holder's user doc the resolver reads. */
export type RecipientHolder = Pick<
  UserEntity,
  "firstName" | "lastName" | "billingAddress"
>;

export interface ResolvedRecipient {
  /** First line of the recipient block (person or company name). */
  recipientName: string;
  /** Postal address, or null when none is known — the PDF then renders the name only. */
  billingAddress: BillingAddress | null;
}

/** A partial address is worse than none — require every postal line. */
function completeAddress(
  addr: Partial<BillingAddress> | null | undefined,
): BillingAddress | null {
  if (!addr || !addr.street || !addr.zip || !addr.city) return null;
  return {
    company: addr.company ?? "",
    street: addr.street,
    zip: addr.zip,
    city: addr.city,
  };
}

/**
 * Resolution order:
 *   1. A firma person with a person-level `billingAddress` → the company
 *      identifies the recipient (unchanged from #269).
 *   2. The account holder (`holder`, from `bill.userId` / `checkout.userId`):
 *      canonical name is `firstName lastName` from the user doc (ADR-0043 —
 *      the payer is not necessarily first on a family roster), address when
 *      the stored one is complete. `company` is carried through so a firma
 *      user without a person-level address still gets the company line.
 *   3. Otherwise the check-in name of the first person, plus the
 *      person-level address if complete (the wizard pre-fills a signed-in
 *      member's own address, so this also covers a failed holder read).
 *   4. Name only; "Unbekannt" when there are no persons at all.
 */
export function pickRecipient({
  persons,
  holder,
}: {
  persons: CheckoutPersonEntity[];
  holder: RecipientHolder | null;
}): ResolvedRecipient {
  for (const person of persons) {
    if (person.userType === "firma" && person.billingAddress) {
      return {
        recipientName: person.billingAddress.company || person.name,
        billingAddress: person.billingAddress,
      };
    }
  }

  const first = persons[0];
  const holderName = holder ? formatFullName(holder) : "";
  const recipientName = holderName || first?.name || "Unbekannt";

  const billingAddress =
    completeAddress(holder?.billingAddress) ??
    completeAddress(first?.billingAddress);

  return { recipientName, billingAddress };
}

/**
 * Resolve the recipient for a bill from its surviving checkouts, reading
 * the account holder's user doc once. Fails soft: a failed or missing read
 * degrades to the check-in name, never to a failed PDF.
 */
export async function loadRecipient(
  bill: { userId?: DocumentReference | null },
  checkouts: CheckoutEntity[],
): Promise<ResolvedRecipient> {
  const persons = checkouts.flatMap((checkout) => checkout.persons ?? []);
  const holderRef: DocumentReference | null =
    bill.userId ?? checkouts[0]?.userId ?? null;

  let holder: RecipientHolder | null = null;
  if (holderRef) {
    try {
      const snap = await holderRef.get();
      if (snap.exists) {
        holder = (snap.data() as UserEntity | undefined) ?? null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        `loadRecipient: failed to load account holder ${holderRef.path} for the recipient block`,
        { error: message },
      );
    }
  }

  return pickRecipient({ persons, holder });
}
