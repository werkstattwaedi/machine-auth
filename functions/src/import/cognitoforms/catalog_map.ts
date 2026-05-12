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
 * Values are intentionally `TBD` placeholders. The catalog cleanup
 * tracked in issue #253 will assign the real IDs before the importer
 * deploys. `assertCatalogIdsReady()` fails loudly at runtime if any are
 * still `TBD`, so we can't accidentally ship an import with broken refs.
 */
export const COGNITOFORMS_CATALOG_IDS = {
  /** NutzungStationäreMaschinen — workshop "holz", pricingModel "time". */
  stationaereMaschinen: "TBD",
  /** NutzungDrechselbank — workshop "holz", pricingModel "time". */
  drechselbank: "TBD",
  /** NutzungMaschinenSchweissanlage — workshop "metall", pricingModel "time". */
  maschinenSchweissanlage: "TBD",
  /** NutzungPlasmaschneiderBrenner — workshop "metall", pricingModel "time". */
  plasmaschneiderBrenner: "TBD",
  /** NutzungLötstation — workshop "schmuck", pricingModel "time". */
  loetstation: "TBD",
  /** NutzungGlasperlenstation — workshop "glas", pricingModel "time". */
  glasperlenstation: "TBD",
  /** NutzungSchleifmaschinen — workshop "stein", pricingModel "time". */
  schleifmaschinen: "TBD",
  /** NutzungSandstrahlen (stein/glas area) — workshop "stein", pricingModel "count" (by Grösse). */
  sandstrahlenStein: "TBD",
  /** NutzungSandstrahlenMetall — workshop "metall", pricingModel "count" (by Grösse). */
  sandstrahlenMetall: "TBD",
  /** NutzungFDM3DDrucker Kategorie 1 (Standard) — workshop "makerspace", pricingModel "weight". */
  fdmFilamentStandard: "TBD",
  /** NutzungFDM3DDrucker Kategorie 2 (Spezial) — workshop "makerspace", pricingModel "weight". */
  fdmFilamentSpezial: "TBD",
  /** NutzungFDM3DDrucker Kategorie 3 (Technisch) — workshop "makerspace", pricingModel "weight". */
  fdmFilamentTechnisch: "TBD",
} as const;

export type CognitoformsCatalogKey = keyof typeof COGNITOFORMS_CATALOG_IDS;

/** Throws if any catalog ID is still the `TBD` placeholder. */
export function assertCatalogIdsReady(): void {
  const missing = Object.entries(COGNITOFORMS_CATALOG_IDS)
    .filter(([, id]) => id === "TBD")
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(
      `COGNITOFORMS_CATALOG_IDS not configured for: ${missing.join(", ")}. ` +
        `Fill in functions/src/import/cognitoforms/catalog_map.ts before running the importer.`,
    );
  }
}

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
