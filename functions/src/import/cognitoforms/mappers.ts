// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Pure mappers — CognitoForms entry JSON → Firestore checkout + items.
 *
 * Kept side-effect-free so they're trivially unit-testable from
 * `__fixtures__/*.json` without an emulator. The orchestrator wraps these
 * in a Firestore WriteBatch in `run_import.ts`.
 */

import type {
  PricingModel,
  UsageType,
  CheckoutPersonEntity,
} from "../../types/firestore_entities";
import type {
  CfDiversesRow,
  CfEntry,
  CfMaterialRow,
  CfNutzungFdmRow,
  CfNutzungSandstrahlenRow,
  CfNutzungSingular,
  CfPerson,
} from "./schema_types";
import {
  COGNITOFORMS_CATALOG_IDS,
  fdmFilamentKeyForKategorie,
  type CognitoformsCatalogKey,
} from "./catalog_map";

/**
 * Mirror of `CheckoutItemEntity` minus the server-only fields (`created`,
 * `catalogId` as DocumentReference). Stored as plain values until the
 * orchestrator resolves catalog refs and timestamps.
 */
export interface MappedCheckoutItem {
  workshop: string;
  description: string;
  origin: "manual";
  /** Resolved by the orchestrator using `COGNITOFORMS_CATALOG_IDS[catalogKey]`. */
  catalogKey: CognitoformsCatalogKey | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  pricingModel: PricingModel;
  formInputs?: { quantity: number; unit: string }[];
}

export interface MappedCheckout {
  docId: string;
  usageType: UsageType;
  workshopsVisited: string[];
  persons: CheckoutPersonEntity[];
  createdIso: string | null;
  closedIso: string | null;
  /** `Total` from the form for reconcile audit. */
  sourceTotal: number;
  /** `Trinkgeld` from the form, default 0. */
  tip: number;
  items: MappedCheckoutItem[];
}

const CHECKOUT_ID_PREFIX = "zzCognitoForms";

/** Builds the deterministic checkout doc ID from `Entry.Number`. */
export function checkoutIdForEntry(entry: CfEntry): string {
  const number = entry.Entry?.Number;
  if (number == null || !Number.isFinite(number)) {
    throw new Error(
      `CognitoForms entry missing Entry.Number — cannot build deterministic checkoutId for entry ${entry.Id ?? "<unknown>"}`,
    );
  }
  return `${CHECKOUT_ID_PREFIX}${String(number).padStart(6, "0")}`;
}

/** Top-level mapper. */
export function mapEntryToCheckout(entry: CfEntry): MappedCheckout {
  const persons = (entry.DeineAngaben ?? []).map(mapPerson);
  const items: MappedCheckoutItem[] = [];

  // Singular Nutzung* blocks → one item each (machine time)
  collectIfPresent(
    items,
    mapNutzungSingular(entry.NutzungStationäreMaschinen ?? null, {
      workshop: "holz",
      description: "Stationäre Maschinen",
      catalogKey: "stationaereMaschinen",
    }),
  );
  collectIfPresent(
    items,
    mapNutzungSingular(entry.NutzungDrechselbank ?? null, {
      workshop: "holz",
      description: "Drechselbank",
      catalogKey: "drechselbank",
    }),
  );
  collectIfPresent(
    items,
    mapNutzungSingular(entry.NutzungMaschinenSchweissanlage ?? null, {
      workshop: "metall",
      description: "Maschinen / Schweissanlage",
      catalogKey: "maschinenSchweissanlage",
    }),
  );
  collectIfPresent(
    items,
    mapNutzungSingular(entry.NutzungPlasmaschneiderBrenner ?? null, {
      workshop: "metall",
      description: "Plasmaschneider / Brenner",
      catalogKey: "plasmaschneiderBrenner",
    }),
  );
  collectIfPresent(
    items,
    mapNutzungSingular(entry.NutzungLötstation ?? null, {
      workshop: "schmuck",
      description: "Lötstation",
      catalogKey: "loetstation",
    }),
  );
  collectIfPresent(
    items,
    mapNutzungSingular(entry.NutzungGlasperlenstation ?? null, {
      workshop: "glas",
      description: "Glasperlenstation",
      catalogKey: "glasperlenstation",
    }),
  );
  collectIfPresent(
    items,
    mapNutzungSingular(entry.NutzungSchleifmaschinen ?? null, {
      workshop: "stein",
      description: "Schleifmaschinen",
      catalogKey: "schleifmaschinen",
    }),
  );

  // Sandstrahlen arrays (machine time, billed per item × Grösse)
  for (const row of entry.NutzungSandstrahlen ?? []) {
    const item = mapSandstrahlenRow(row, {
      workshop: "stein",
      descriptionPrefix: "Sandstrahlen",
      catalogKey: "sandstrahlenStein",
    });
    if (item) items.push(item);
  }
  for (const row of entry.NutzungSandstrahlenMetall ?? []) {
    const item = mapSandstrahlenRow(row, {
      workshop: "metall",
      descriptionPrefix: "Sandstrahlen Metall",
      catalogKey: "sandstrahlenMetall",
    });
    if (item) items.push(item);
  }

  // FDM 3D printer rows — filament purchase (material, not machine time)
  for (const row of entry.NutzungFDM3DDrucker ?? []) {
    const item = mapFdmFilamentRow(row);
    if (item) items.push(item);
  }

  // Materialbezug* arrays → one item per row, no catalogId
  const materialArrays: [string, CfMaterialRow[] | null | undefined][] = [
    ["holz", entry.MaterialbezugHolzwerkstatt],
    ["metall", entry.MaterialbezugMetallwerkstatt],
    ["textil", entry.MaterialbezugTextilAtelier],
    ["keramik", entry.MaterialbezugKeramikAtelier],
    ["schmuck", entry.MaterialbezugSchmuckAtelier],
    ["glas", entry.MaterialbezugGlasAtelier],
    ["stein", entry.MaterialbezugSteinAtelier2],
    ["malen", entry.MaterialbezugMalenUndBasteln],
  ];
  for (const [workshop, arr] of materialArrays) {
    for (const row of arr ?? []) {
      const item = mapMaterialRow(row, workshop);
      if (item) items.push(item);
    }
  }

  // Free-form Diverses arrays
  for (const row of entry.Diverses ?? []) {
    const item = mapDiversesRow(row, "diverses");
    if (item) items.push(item);
  }
  for (const row of entry.DiversesMakerSpace2 ?? []) {
    const item = mapDiversesRow(row, "makerspace");
    if (item) items.push(item);
  }

  const workshopsVisited = mapWorkshopsVisited(
    entry.WerkstättenWählen?.FürWelcheWerkstättenMöchtestDuKostenErfassen ??
      null,
    items,
  );

  return {
    docId: checkoutIdForEntry(entry),
    usageType: derivedUsageType(persons, items),
    workshopsVisited,
    persons,
    createdIso: entry.Entry?.DateCreated ?? null,
    closedIso: entry.Entry?.DateSubmitted ?? null,
    sourceTotal: numberOr(entry.Total, 0),
    tip: numberOr(entry.Trinkgeld, 0),
    items,
  };
}

/**
 * Aggregate per-person `Nutzungsart` into a single checkout-level
 * `usageType` (precedence: hangenmoos > intern > materialbezug
 * (all persons + no machine items) > ermaessigt > regular).
 */
export function derivedUsageType(
  persons: CheckoutPersonEntity[],
  items: MappedCheckoutItem[],
): UsageType {
  const nutzungsarten = persons.map((p) =>
    // We stashed the original Nutzungsart on the person via mapPerson →
    // `(p as PersonWithMeta).cfNutzungsart`. Re-read here.
    (p as PersonWithCfMeta).cfNutzungsart ?? null,
  );

  if (nutzungsarten.some((n) => n === "Hangenmoos AG")) return "hangenmoos";
  if (nutzungsarten.some((n) => n === "Interne Nutzung")) return "intern";

  const hasMachineItems = items.some((i) => i.catalogKey != null);
  const allMaterialbezug =
    nutzungsarten.length > 0 &&
    nutzungsarten.every((n) => n === "Nur Materialbezug");
  if (allMaterialbezug && !hasMachineItems) return "materialbezug";

  if (nutzungsarten.some((n) => n === "Ermässigte Nutzung (KulturLegi)")) {
    return "ermaessigt";
  }
  return "regular";
}

interface PersonWithCfMeta extends CheckoutPersonEntity {
  /** Internal carry-over for the usageType reducer. Stripped before writing. */
  cfNutzungsart?: CfPerson["Nutzungsart"];
}

export function mapPerson(p: CfPerson): CheckoutPersonEntity {
  const userType = mapUserType(p.Nutzerin);
  const billingAddress =
    userType === "firma" ? mapBillingAddress(p.Rechnungsadresse2) : undefined;

  const person: PersonWithCfMeta = {
    name: combineName(p.Vorname, p.Nachname),
    email: p.EMail ?? "",
    userType,
    cfNutzungsart: p.Nutzungsart,
  };
  if (billingAddress) person.billingAddress = billingAddress;
  return person;
}

/**
 * Strips the `cfNutzungsart` internal field before writing persons to
 * Firestore. The orchestrator calls this on each person right before the
 * batch commit.
 */
export function stripPersonInternals(p: CheckoutPersonEntity): CheckoutPersonEntity {
  const clone = { ...(p as PersonWithCfMeta) };
  delete clone.cfNutzungsart;
  return clone;
}

function mapUserType(n: CfPerson["Nutzerin"]): "erwachsen" | "kind" | "firma" {
  if (n === "Kind (u. 18)") return "kind";
  if (n === "Firma") return "firma";
  return "erwachsen";
}

function mapBillingAddress(
  addr: CfPerson["Rechnungsadresse2"],
): CheckoutPersonEntity["billingAddress"] {
  if (!addr) return undefined;
  return {
    company: combineCompany(addr.Firma, addr.FirmaZusatz),
    street: combineStreet(addr.StrasseNr, addr.AdresseZusatz),
    zip: addr.PLZ ?? "",
    city: addr.Ort ?? "",
  };
}

function combineName(vorname?: string | null, nachname?: string | null): string {
  const parts = [vorname, nachname].filter(
    (s) => s != null && s.trim() !== "",
  );
  return parts.join(" ").trim();
}

function combineCompany(
  firma?: string | null,
  zusatz?: string | null,
): string {
  if (!firma && !zusatz) return "";
  if (firma && zusatz) return `${firma} — ${zusatz}`;
  return firma ?? zusatz ?? "";
}

function combineStreet(
  strasse?: string | null,
  zusatz?: string | null,
): string {
  if (!strasse && !zusatz) return "";
  if (strasse && zusatz) return `${strasse}, ${zusatz}`;
  return strasse ?? zusatz ?? "";
}

interface NutzungSingularMeta {
  workshop: string;
  description: string;
  catalogKey: CognitoformsCatalogKey;
}

export function mapNutzungSingular(
  obj: CfNutzungSingular | null,
  meta: NutzungSingularMeta,
): MappedCheckoutItem | null {
  const hours = numberOr(obj?.AnzahlStunden, 0);
  const total = numberOr(obj?.Zwischentotal, 0);
  if (hours <= 0 || total <= 0) return null;
  const unitPrice = total / hours;
  const description =
    obj?.Rabatt && obj.Rabatt !== "Nein"
      ? `${meta.description} (Rabatt: ${obj.Rabatt})`
      : meta.description;
  return {
    workshop: meta.workshop,
    description,
    origin: "manual",
    catalogKey: meta.catalogKey,
    quantity: hours,
    unitPrice,
    totalPrice: total,
    pricingModel: "time",
    formInputs: [{ quantity: hours, unit: "h" }],
  };
}

interface SandstrahlenMeta {
  workshop: string;
  descriptionPrefix: string;
  catalogKey: CognitoformsCatalogKey;
}

export function mapSandstrahlenRow(
  row: CfNutzungSandstrahlenRow,
  meta: SandstrahlenMeta,
): MappedCheckoutItem | null {
  const anzahl = numberOr(row.Anzahl, 0);
  const betrag = numberOr(row.Betrag, 0);
  if (anzahl <= 0 || betrag <= 0) return null;
  const groesse = row.Grösse ?? "";
  return {
    workshop: meta.workshop,
    description: groesse
      ? `${meta.descriptionPrefix} — ${groesse}`
      : meta.descriptionPrefix,
    origin: "manual",
    catalogKey: meta.catalogKey,
    quantity: anzahl,
    unitPrice: betrag / anzahl,
    totalPrice: betrag,
    pricingModel: "count",
    formInputs: [{ quantity: anzahl, unit: "Stk." }],
  };
}

/**
 * FDM 3D printer row → filament purchase (material). Dispatches to one of
 * three catalog items by Kategorie. Quantity is stored as kg (the SI base
 * unit for the `weight` pricing model — see `getStorageBaseUnit`).
 */
export function mapFdmFilamentRow(
  row: CfNutzungFdmRow,
): MappedCheckoutItem | null {
  const gramm = numberOr(row.Gewichtg, 0);
  const betrag = numberOr(row.Betrag, 0);
  if (gramm <= 0 || betrag <= 0) return null;
  const kategorie = row.Kategorie ?? "";
  const catalogKey = fdmFilamentKeyForKategorie(kategorie);
  if (catalogKey == null) {
    // Unknown Kategorie — write as ad-hoc material with no catalog link
    // so the data isn't lost, but flag it for review via description.
    return {
      workshop: "makerspace",
      description: `Filament — ${kategorie || "(unbekannte Kategorie)"}`,
      origin: "manual",
      catalogKey: null,
      quantity: gramm / 1000,
      unitPrice: betrag / (gramm / 1000),
      totalPrice: betrag,
      pricingModel: "weight",
      formInputs: [{ quantity: gramm, unit: "g" }],
    };
  }
  const kg = gramm / 1000;
  return {
    workshop: "makerspace",
    description: `Filament — ${kategorie}`,
    origin: "manual",
    catalogKey,
    quantity: kg,
    unitPrice: betrag / kg,
    totalPrice: betrag,
    pricingModel: "weight",
    formInputs: [{ quantity: gramm, unit: "g" }],
  };
}

export function mapMaterialRow(
  row: CfMaterialRow,
  workshop: string,
): MappedCheckoutItem | null {
  const kategorie = (row.Kategorie ?? "").trim();
  if (!kategorie) return null;

  const remark =
    (row.MaterialBemerkungen ?? row.Material ?? "").trim() || null;

  // CHF (Pauschal) → freeform line item with KostenCHF as the price.
  if (kategorie.startsWith("CHF ")) {
    const total = numberOr(row.KostenCHF, 0);
    if (total <= 0) return null;
    const description = row.BezogeneLeistungen?.trim() || kategorie;
    return {
      workshop,
      description: remark
        ? `${description} — ${remark}`
        : description,
      origin: "manual",
      catalogKey: null,
      quantity: 1,
      unitPrice: total,
      totalPrice: total,
      pricingModel: "direct",
    };
  }

  const pricingModel = inferPricingModelFromKategorie(kategorie);
  if (!pricingModel) return null;

  const { quantity, unit, total } = extractMaterialQuantity(row, pricingModel);
  if (quantity == null || total == null || quantity <= 0 || total <= 0) {
    return null;
  }
  const description = remark
    ? `${kategorie} — ${remark}`
    : kategorie;
  return {
    workshop,
    description,
    origin: "manual",
    catalogKey: null,
    quantity,
    unitPrice: total / quantity,
    totalPrice: total,
    pricingModel,
    formInputs: unit ? [{ quantity, unit }] : undefined,
  };
}

/** Discriminate the Materialbezug `Kategorie` enum into a pricing model. */
export function inferPricingModelFromKategorie(
  kategorie: string,
): PricingModel | null {
  // Match leading dimension hint, e.g. "m2 (Platten…)" / "Stk. (…)" / "kg (Ton…)".
  if (/^m2\b/.test(kategorie)) return "area";
  if (/^m\b/.test(kategorie)) return "length";
  if (/^kg\b/.test(kategorie)) return "weight";
  if (/^g\b/.test(kategorie)) return "weight";
  if (/^l\b/.test(kategorie)) return "weight"; // volume tracked as weight in our model
  if (/^Stk\.?/.test(kategorie)) return "count";
  return null;
}

interface MaterialQuantity {
  quantity: number | null;
  unit: string | null;
  total: number | null;
}

function extractMaterialQuantity(
  row: CfMaterialRow,
  pricingModel: PricingModel,
): MaterialQuantity {
  switch (pricingModel) {
    case "area": {
      // Prefer the pre-calculated `M2`; fall back to length × breadth in cm.
      const m2 =
        numberOrNull(row.M2) ??
        (cmToM(row.Längecm ?? row.Längecm2) != null &&
        cmToM(row.Breitecm ?? row.Breitecm2) != null
          ? (cmToM(row.Längecm ?? row.Längecm2) ?? 0) *
            (cmToM(row.Breitecm ?? row.Breitecm2) ?? 0)
          : null);
      return {
        quantity: m2,
        unit: "m²",
        total: numberOrNull(row.Betrag),
      };
    }
    case "length": {
      const cm = row.Längecm ?? row.Längecm2;
      const meters = cmToM(cm);
      return {
        quantity: meters,
        unit: "m",
        total: numberOrNull(row.Betrag),
      };
    }
    case "weight": {
      const kg =
        numberOrNull(row.Mengekg) ??
        (numberOrNull(row.Mengeg) != null
          ? (numberOrNull(row.Mengeg) ?? 0) / 1000
          : null) ??
        numberOrNull(row.Mengel); // volume tracked as weight-model qty
      return {
        quantity: kg,
        unit: "kg",
        // Betrag2 is the MalenBasteln-specific liquid-row total.
        total: numberOrNull(row.Betrag) ?? numberOrNull(row.Betrag2),
      };
    }
    case "count": {
      return {
        quantity: numberOrNull(row.Anzahl),
        unit: "Stk.",
        total: numberOrNull(row.Betrag),
      };
    }
    default:
      return { quantity: null, unit: null, total: null };
  }
}

function cmToM(cm: number | null | undefined): number | null {
  const n = numberOrNull(cm);
  return n == null ? null : n / 100;
}

export function mapDiversesRow(
  row: CfDiversesRow,
  workshop: "diverses" | "makerspace",
): MappedCheckoutItem | null {
  const total = numberOr(row.KostenCHF, 0);
  if (total <= 0) return null;
  const description = row.BezogeneLeistungen?.trim() || "(ohne Beschreibung)";
  return {
    workshop,
    description,
    origin: "manual",
    catalogKey: null,
    quantity: 1,
    unitPrice: total,
    totalPrice: total,
    pricingModel: "direct",
  };
}

function mapWorkshopsVisited(
  selected: string[] | null,
  items: MappedCheckoutItem[],
): string[] {
  // Prefer the user-stated workshop list when present; otherwise derive
  // from the item set so reports still group correctly.
  const labelToCode: Record<string, string> = {
    Holz: "holz",
    Metall: "metall",
    Textil: "textil",
    Keramik: "keramik",
    Schmuck: "schmuck",
    Glas: "glas",
    Stein: "stein",
    "Malen und Basteln": "malen",
    "Maker Space": "makerspace",
    Diverses: "diverses",
  };
  const fromSelection = (selected ?? [])
    .map((label) => labelToCode[label])
    .filter((c): c is string => Boolean(c));
  if (fromSelection.length > 0) return Array.from(new Set(fromSelection));
  return Array.from(new Set(items.map((i) => i.workshop)));
}

function collectIfPresent<T>(arr: T[], v: T | null): void {
  if (v != null) arr.push(v);
}

function numberOr(v: number | null | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function numberOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export { COGNITOFORMS_CATALOG_IDS };
