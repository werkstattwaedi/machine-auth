// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { PriceListRenderData } from "../../src/price_list/types";

export function smallPriceList(): PriceListRenderData {
  return {
    name: "Holzwerkstatt – Materialliste",
    footer: "Preise inkl. Verbrauchsmaterial. Stand: April 2026.",
    qrUrl: "https://checkout.example.com/material/add?priceList=small-1",
    items: [
      {
        code: "H001",
        name: "Sperrholz Birke 4mm",
        pricingModel: "area",
        unitPrice: { none: 25, member: 20 },
      },
      {
        code: "H002",
        name: "Buchenleimholz 18mm",
        pricingModel: "area",
        unitPrice: { none: 65.5, member: 52.4 },
      },
      {
        code: "H010",
        name: "Stationäre Maschinen",
        pricingModel: "time",
        unitPrice: { none: 50, member: 25 },
      },
    ],
  };
}

export function mixedPriceList(): PriceListRenderData {
  return {
    name: "Verbrauchsmaterial",
    footer: "Mitgliederpreise gelten für Vereinsmitglieder.",
    qrUrl: "https://checkout.example.com/material/add?priceList=mixed-1",
    items: [
      {
        code: "M001",
        name: "Schleifpapier (P120, 230x280mm)",
        pricingModel: "count",
        unitPrice: { none: 1.5, member: 1.2 },
      },
      {
        code: "M002",
        name: "Holzleim D3 wasserfest",
        pricingModel: "weight",
        unitPrice: { none: 12, member: 10 },
      },
      {
        code: "S001",
        name: "SLA Resin Tough (1L)",
        pricingModel: "sla",
        unitPrice: { none: 180, member: 150 },
      },
      {
        code: "D001",
        name: "Lasergravur-Pauschale",
        pricingModel: "direct",
        unitPrice: { none: 30, member: 24 },
      },
    ],
  };
}

/**
 * A long list that spills onto a second page so the paginator behaviour
 * (re-render header on continuation pages, leave footer band intact on the
 * last page) is exercised by the visual tests.
 */
export function longPriceList(): PriceListRenderData {
  const items = [];
  for (let i = 0; i < 60; i++) {
    items.push({
      code: `L${String(i + 1).padStart(3, "0")}`,
      name: `Material ${i + 1} – ein etwas längerer Beschreibungstext zum Testen`,
      pricingModel: (["area", "time", "count", "weight"][i % 4] as
        | "area"
        | "time"
        | "count"
        | "weight"),
      unitPrice: { none: 10 + i, member: 8 + i },
    });
  }
  return {
    name: "Lange Preisliste",
    footer: "Preise gültig bis Ende 2026.",
    qrUrl: "https://checkout.example.com/material/add?priceList=long-1",
    items,
  };
}

/** Empty-item edge case: footer + QR still need to render. */
export function emptyPriceList(): PriceListRenderData {
  return {
    name: "Leere Liste",
    footer: "Noch keine Einträge.",
    qrUrl: "https://checkout.example.com/material/add?priceList=empty-1",
    items: [],
  };
}
