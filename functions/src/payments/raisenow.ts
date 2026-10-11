// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * RaiseNow PayLink integration (payment method "raisenow", ADR-0020).
 *
 * The free plan has no webhook: we only pre-fill a PayLink URL; the
 * customer pays TWINT on pay.raisenow.io and states it with the commit
 * button. Settlement is matched later through the RaiseNow CSV import
 * (admin `invoices/import`), keyed by the SCOR creditor reference this
 * link carries.
 */

import { defineString } from "firebase-functions/params";

// RaiseNow PayLink solution ID (the short code in https://pay.raisenow.io/{id})
const raisenowPaylinkSolutionId = defineString("RAISENOW_PAYLINK_SOLUTION_ID");

const RAISENOW_PAYLINK_BASE_URL = "https://pay.raisenow.io";

export interface RaisenowPaylinkInput {
  amount: number;
  /** ISO 11649 SCOR reference — the key the statement import matches on. */
  scorReference: string;
  payer: { name: string; email?: string } | null;
}

export function buildRaisenowPaylinkUrl({
  amount,
  scorReference,
  payer,
}: RaisenowPaylinkInput): string {
  const params = new URLSearchParams();
  params.set("amount.values", amount.toFixed(2));
  params.set("amount.custom", "false");
  // TWINT silently ignores unknown parameters, so the spelling matters:
  // `reference.creditor`, not the `.value` suffix of the supporter fields.
  params.set("reference.creditor", scorReference);

  if (payer) {
    const nameParts = payer.name.trim().split(/\s+/);
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.slice(1).join(" ") || firstName;
    params.set("supporter.first_name.value", firstName);
    params.set("supporter.last_name.value", lastName);
    if (payer.email) {
      params.set("supporter.email.value", payer.email);
    }
  }

  return `${RAISENOW_PAYLINK_BASE_URL}/${raisenowPaylinkSolutionId.value()}?${params.toString()}`;
}
