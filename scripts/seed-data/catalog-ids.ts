// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Pinned 20-char Firestore-shaped IDs for catalog items referenced from
 * production code. Mirror of the corresponding `id` fields in the seed
 * JSON (`scripts/seed-data/catalog.json`); the seed is the source of
 * truth, this file is a typed handle.
 *
 * Generated once with Firestore's auto-ID character set
 * (A-Z, a-z, 0-9, length 20) and committed here. Reseeds preserve them.
 *
 * Why pin: the membership SKU and the 12 CognitoForms-importer categories
 * are fetched by doc ID from production code. Every other catalog entry
 * is reached either by query (`workshops` array-contains) or via the
 * machine's `checkoutTemplateId` ref — those don't need a typed handle.
 */

/** Doc ID for the Mitgliedschaft catalog item. Variants: "single", "family". */
export const MEMBERSHIP_CATALOG_ID = "bWJodoXu3B3kiHMyFd7f";

/**
 * Doc IDs for the catalog items the daily CognitoForms importer stamps
 * onto CheckoutItem.catalogId. Issue #253.
 *
 * Per-key workshop / pricingModel hints (for the catalog seed authoring):
 * - `stationaereMaschinen`        — holz       / time
 * - `drechselbank`                — holz       / time
 * - `maschinenSchweissanlage`     — metall     / time
 * - `plasmaschneiderBrenner`      — metall     / time
 * - `loetstation`                 — schmuck    / time
 * - `glasperlenstation`           — glas       / time
 * - `schleifmaschinen`            — stein      / time
 * - `sandstrahlenStein`           — stein      / count (by Grösse)
 * - `sandstrahlenMetall`          — metall     / count (by Grösse)
 * - `fdmFilamentStandard`         — makerspace / weight
 * - `fdmFilamentSpezial`          — makerspace / weight
 * - `fdmFilamentTechnisch`        — makerspace / weight
 */
export const COGNITOFORMS_CATALOG_IDS = {
  stationaereMaschinen: "dfoYVuO3bhRJoRCbgND1",
  drechselbank: "LZ04lfdfdEieqQOsKhzi",
  maschinenSchweissanlage: "7SlZb0jUKcyE8sMcvyzD",
  plasmaschneiderBrenner: "kcspOmeZ3lsj4hNfHD4V",
  loetstation: "tot0yitdBPf2hseDSuFf",
  glasperlenstation: "17mC1Qe4xn2dfGNpsdfo",
  schleifmaschinen: "ljE5dcV7qDv0Z50BdwHY",
  sandstrahlenStein: "3XpXkmq3mGovXJ21h4pw",
  sandstrahlenMetall: "qG7OVbhnFp0vZM6BwCBB",
  fdmFilamentStandard: "UktnpwyJBpy4qSDP6nYg",
  fdmFilamentSpezial: "YB3jmyQ4nPRn4QdSL0r2",
  fdmFilamentTechnisch: "uLycIXO6PZ0ku2FlHxvv",
} as const;

export type CognitoformsCatalogKey = keyof typeof COGNITOFORMS_CATALOG_IDS;
