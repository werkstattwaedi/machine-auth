// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Pinned 20-char Firestore-shaped IDs for catalog items referenced from
 * production code. Mirror of the corresponding `id` fields in the per-
 * workshop seed JSON files under `scripts/seed-data/catalog/*.json` —
 * the seed is the source of truth, this file is a typed handle.
 *
 * Generated once with Firestore's auto-ID character set
 * (A-Z, a-z, 0-9, length 20) and committed here. Reseeds preserve them.
 *
 * Why pin: the membership SKU is fetched by doc ID from production code.
 * Every other catalog entry is reached either by query (`workshops`
 * array-contains) or via the machine's `checkoutTemplateId` ref — those
 * don't need a typed handle.
 */

/** Doc ID for the Mitgliedschaft catalog item. Variants: "single", "family". */
export const MEMBERSHIP_CATALOG_ID = "bWJodoXu3B3kiHMyFd7f";
