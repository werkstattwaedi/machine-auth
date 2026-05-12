// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Hand-written TypeScript types for the SelfCheckout CognitoForms entry
 * payload. Mirrors the JSON-Schema returned by
 * `GET /api/forms/12/schema` (captured as `__fixtures__/schema.json`).
 *
 * Only the fields the importer actually reads are typed. Index signatures
 * and pass-through `unknown` values cover the calculated/aggregate columns
 * we don't touch (Z*, OhneTitel*, *_IncrementBy, etc.).
 */

/** Per-person entry — `DeineAngaben` array element. */
export interface CfPerson {
  Vorname?: string | null;
  Nachname?: string | null;
  EMail?: string | null;
  Nutzerin?: "Erwachsen" | "Kind (u. 18)" | "Firma" | null;
  Nutzungsart?:
    | "Reguläre Nutzung"
    | "Ermässigte Nutzung (KulturLegi)"
    | "Nur Materialbezug"
    | "Interne Nutzung"
    | "Hangenmoos AG"
    | null;
  Nutzungsgebühr?: number | null;
  Rechnungsadresse2?: CfBillingAddress | null;
  Id?: string | null;
  ItemNumber?: number | null;
}

export interface CfBillingAddress {
  Firma?: string | null;
  FirmaZusatz?: string | null;
  StrasseNr?: string | null;
  AdresseZusatz?: string | null;
  PLZ?: string | null;
  Ort?: string | null;
}

/** Singular machine-time block (hourly billing). */
export interface CfNutzungSingular {
  AnzahlStunden?: number | null;
  Rabatt?: "Nein" | "Mitglied OWW" | "Intern" | null;
  Kostenh?: string | null; // pre-formatted display string, do not parse for math
  Zwischentotal?: number | null;
}

/** Sandstrahlen array row (per-item billing by Grösse). */
export interface CfNutzungSandstrahlenRow {
  Anzahl?: number | null;
  Grösse?: string | null; // Klein/Mittel/Gross with size descriptors
  Betrag?: number | null;
  Id?: string | null;
}

/** FDM 3D printer (filament) array row. */
export interface CfNutzungFdmRow {
  Gewichtg?: number | null;
  Kategorie?: string | null; // "Kategorie 1 (Standard)" / "2 (Spezial)" / "3 (Technisch)"
  Betrag?: number | null;
  Id?: string | null;
}

/** Material array row — shape varies per workshop. */
export interface CfMaterialRow {
  Kategorie?: string | null;
  MaterialBemerkungen?: string | null;
  /** Some workshops use `Material` instead of `MaterialBemerkungen`. */
  Material?: string | null;
  /** Area dimensions (cm × cm). Two spellings across workshops. */
  Längecm?: number | null;
  Breitecm?: number | null;
  Längecm2?: number | null;
  Breitecm2?: number | null;
  /** Pre-calculated area (m²). */
  M2?: number | null;
  Anzahl?: number | null;
  Mengeg?: number | null;
  Mengekg?: number | null;
  Mengel?: number | null;
  Preism2?: number | null;
  Preislm?: number | null;
  Preiskg?: number | null;
  Preisg?: number | null;
  Preisl?: number | null;
  PreisStück?: number | null;
  Betrag?: number | null;
  Betrag2?: number | null; // MalenBasteln uses a second total column for liquids
  BezogeneLeistungen?: string | null;
  KostenCHF?: number | null;
  Id?: string | null;
}

export interface CfDiversesRow {
  BezogeneLeistungen?: string | null;
  KostenCHF?: number | null;
  Id?: string | null;
}

export interface CfWerkstaettenWahl {
  FürWelcheWerkstättenMöchtestDuKostenErfassen?: string[] | null;
}

export interface CfOrder {
  Date?: string | null;
  Id?: string | null;
  PaymentMessage?: string | null;
  PaymentStatus?: string | null;
}

export interface CfEntryMeta {
  DateCreated?: string | null;
  DateSubmitted?: string | null;
  DateUpdated?: string | null;
  Number?: number | null;
  Order?: CfOrder | null;
  Timestamp?: string | null;
  Status?: "Incomplete" | "Submitted" | null;
}

/**
 * Top-level CognitoForms entry as returned by
 * `GET /forms/12/entries/{id}` and `GET /forms/12/entries`.
 */
export interface CfEntry {
  Id?: string | null;
  DeineAngaben?: CfPerson[] | null;
  WerkstättenWählen?: CfWerkstaettenWahl | null;

  NutzungStationäreMaschinen?: CfNutzungSingular | null;
  NutzungDrechselbank?: CfNutzungSingular | null;
  NutzungMaschinenSchweissanlage?: CfNutzungSingular | null;
  NutzungPlasmaschneiderBrenner?: CfNutzungSingular | null;
  NutzungLötstation?: CfNutzungSingular | null;
  NutzungGlasperlenstation?: CfNutzungSingular | null;
  NutzungSchleifmaschinen?: CfNutzungSingular | null;

  NutzungSandstrahlen?: CfNutzungSandstrahlenRow[] | null;
  NutzungSandstrahlenMetall?: CfNutzungSandstrahlenRow[] | null;
  NutzungFDM3DDrucker?: CfNutzungFdmRow[] | null;

  MaterialbezugHolzwerkstatt?: CfMaterialRow[] | null;
  MaterialbezugMetallwerkstatt?: CfMaterialRow[] | null;
  MaterialbezugTextilAtelier?: CfMaterialRow[] | null;
  MaterialbezugKeramikAtelier?: CfMaterialRow[] | null;
  MaterialbezugSchmuckAtelier?: CfMaterialRow[] | null;
  MaterialbezugGlasAtelier?: CfMaterialRow[] | null;
  MaterialbezugSteinAtelier2?: CfMaterialRow[] | null;
  MaterialbezugMalenUndBasteln?: CfMaterialRow[] | null;

  Diverses?: CfDiversesRow[] | null;
  DiversesMakerSpace2?: CfDiversesRow[] | null;

  Trinkgeld?: number | null;
  Total?: number | null;
  BetragCHF?: number | null;

  Entry?: CfEntryMeta | null;

  // The aggregate readonly fields are present but unused by the importer.
  [key: string]: unknown;
}
