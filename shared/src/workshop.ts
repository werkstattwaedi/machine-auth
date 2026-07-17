// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Canonical workshop identity: ids, display labels, and brand colors from
 * the Farbkonzept OWW (2026-01-14). Shared so server-side renderers (the
 * price-list PDF) use the exact same palette as the web apps' `--color-ws-*`
 * tokens in `web/modules/index.css` — keep the two in sync when the
 * Farbkonzept changes.
 */

export type WorkshopId =
  | "holz"
  | "metall"
  | "textil"
  | "keramik"
  | "schmuck"
  | "glas"
  | "stein"
  | "malen"
  | "makerspace"
  | "diverses";

/**
 * Canonical ordering used when something needs a deterministic workshop
 * sequence without the `config/pricing.workshops[].order` doc at hand.
 */
export const WORKSHOP_IDS: readonly WorkshopId[] = [
  "holz",
  "metall",
  "textil",
  "keramik",
  "schmuck",
  "glas",
  "stein",
  "malen",
  "makerspace",
  "diverses",
];

/** German display names (also the root element of category paths). */
export const WORKSHOP_LABELS: Record<WorkshopId, string> = {
  holz: "Holz",
  metall: "Metall",
  textil: "Textil",
  keramik: "Keramik",
  schmuck: "Schmuck",
  glas: "Glas",
  stein: "Stein",
  malen: "Malen",
  makerspace: "Makerspace",
  diverses: "Diverses",
};

/**
 * Farbkonzept OWW workshop colors. Holz reuses OWW Gold; Textil matches
 * Cog Teal. `diverses` has no brand color — near-neutral hairline grey so a
 * mis-tagged list is visibly "uncolored" rather than wearing another
 * workshop's identity.
 */
export const WORKSHOP_COLORS: Record<WorkshopId, string> = {
  holz: "#ffde80",
  keramik: "#f39a83",
  metall: "#8baddc",
  textil: "#4dbdc6",
  schmuck: "#4dc685",
  glas: "#e77676",
  stein: "#9ebac0",
  malen: "#cb9cdc",
  makerspace: "#a44d6e",
  diverses: "#d4d4d4",
};

export function isWorkshopId(value: string): value is WorkshopId {
  return (WORKSHOP_IDS as readonly string[]).includes(value);
}
