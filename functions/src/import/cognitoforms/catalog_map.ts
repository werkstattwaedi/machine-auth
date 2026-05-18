// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Catalog IDs for imported CognitoForms line items.
 *
 * Every machine-time and filament-material item produced by the importer
 * points at a catalog entry so analytics can group "all hours on the
 * Drechselbank" or "all kg of Standard filament" across the imported
 * history.
 *
 * Server-only mirror of `scripts/seed-data/catalog-ids.ts`. The web app
 * never reads these IDs, so we keep the duplication here rather than
 * route it through `config/catalog-references` (the membership SKU lives
 * there because both functions and web consume it; the CognitoForms refs
 * are server-only by nature). The catalog seed under
 * `scripts/seed-data/catalog/machines.json` writes the corresponding
 * catalog docs at these exact IDs.
 *
 * Keep this file in sync with `scripts/seed-data/catalog-ids.ts`. With
 * `as const` the literal types are narrowed, so a typo in either file
 * is caught at compile time when the importer references a key that no
 * longer exists.
 */
export const COGNITOFORMS_CATALOG_IDS = {
  /** NutzungStationäreMaschinen — workshop "holz", pricingModel "time". */
  stationaereMaschinen: "dfoYVuO3bhRJoRCbgND1",
  /** NutzungDrechselbank — workshop "holz", pricingModel "time". */
  drechselbank: "LZ04lfdfdEieqQOsKhzi",
  /** NutzungMaschinenSchweissanlage — workshop "metall", pricingModel "time". */
  maschinenSchweissanlage: "7SlZb0jUKcyE8sMcvyzD",
  /** NutzungPlasmaschneiderBrenner — workshop "metall", pricingModel "time". */
  plasmaschneiderBrenner: "kcspOmeZ3lsj4hNfHD4V",
  /** NutzungLötstation — workshop "schmuck", pricingModel "time". */
  loetstation: "tot0yitdBPf2hseDSuFf",
  /** NutzungGlasperlenstation — workshop "glas", pricingModel "time". */
  glasperlenstation: "17mC1Qe4xn2dfGNpsdfo",
  /** NutzungSchleifmaschinen — workshop "stein", pricingModel "time". */
  schleifmaschinen: "ljE5dcV7qDv0Z50BdwHY",
  /** NutzungSandstrahlen (stein/glas area) — workshop "stein", pricingModel "count" (by Grösse). */
  sandstrahlenStein: "3XpXkmq3mGovXJ21h4pw",
  /** NutzungSandstrahlenMetall — workshop "metall", pricingModel "count" (by Grösse). */
  sandstrahlenMetall: "qG7OVbhnFp0vZM6BwCBB",
  /** NutzungFDM3DDrucker Kategorie 1 (Standard) — workshop "makerspace", pricingModel "weight". */
  fdmFilamentStandard: "UktnpwyJBpy4qSDP6nYg",
  /** NutzungFDM3DDrucker Kategorie 2 (Spezial) — workshop "makerspace", pricingModel "weight". */
  fdmFilamentSpezial: "YB3jmyQ4nPRn4QdSL0r2",
  /** NutzungFDM3DDrucker Kategorie 3 (Technisch) — workshop "makerspace", pricingModel "weight". */
  fdmFilamentTechnisch: "uLycIXO6PZ0ku2FlHxvv",
} as const;

export type CognitoformsCatalogKey = keyof typeof COGNITOFORMS_CATALOG_IDS;

/** Maps an FDM filament Kategorie enum value to its catalog key. */
export function fdmFilamentKeyForKategorie(
  kategorie: string,
): CognitoformsCatalogKey | null {
  // Tolerate prefix matching — CognitoForms occasionally adds trailing
  // descriptive text in form revisions; we anchor on the leading "Kategorie N".
  if (kategorie.startsWith("Kategorie 1")) return "fdmFilamentStandard";
  if (kategorie.startsWith("Kategorie 2")) return "fdmFilamentSpezial";
  if (kategorie.startsWith("Kategorie 3")) return "fdmFilamentTechnisch";
  return null;
}
