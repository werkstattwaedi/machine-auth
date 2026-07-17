// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Render-data fixtures matching the design handoff's sample data
 * (`preisliste-daten.js`, Stand 14.07.2026). Prices in the Metall fixture
 * beyond Flachstahl are invented pagination-exercise data from the handoff —
 * they exist to spill the Bleche table across a page break, not to document
 * real prices.
 */

import type { PriceListRenderData } from "../../src/price_list/types";

/** Holz: several small categories — the canonical one-page layout. */
export function holzPriceList(): PriceListRenderData {
  return {
    title: "Holz",
    color: "#ffde80",
    stand: "14.07.2026",
    qrUrl: "https://checkout.example.com/visit/add/list/holz-1",
    categories: [
      {
        name: "Massivholz",
        showTitle: true,
        unit: "m²",
        rows: [
          { code: "3001", produkt: "Ahorn", mass: "24 mm", preis: "62.30" },
          { code: "3002", produkt: "Ahorn", mass: "30 mm", preis: "77.85" },
          { code: "3003", produkt: "Ahorn", mass: "40 mm", preis: "103.80" },
          { code: "3004", produkt: "Ahorn", mass: "50 mm", preis: "129.75" },
        ],
      },
      {
        name: "Holzplatten",
        showTitle: true,
        unit: "m²",
        rows: [
          {
            code: "3156",
            produkt: "3-Schichtplatte, Fichte",
            mass: "19 mm",
            preis: "34.80",
          },
          {
            code: "3157",
            produkt: "3-Schichtplatte, Fichte",
            mass: "27 mm",
            preis: "38.65",
          },
          {
            code: "3158",
            produkt: "1-Schichtplatte, Fichte",
            mass: "18 mm",
            preis: "47.80",
          },
          {
            code: "3159",
            produkt: "1-Schichtplatte, Fichte",
            mass: "21 mm",
            preis: "49.60",
          },
        ],
      },
      {
        name: "Rundstäbe",
        showTitle: true,
        unit: "lfm",
        rows: [
          {
            code: "3186",
            produkt: "Rundstab glatt",
            mass: "3 mm",
            preis: "1.40",
          },
          {
            code: "3187",
            produkt: "Rundstab glatt",
            mass: "4 mm",
            preis: "1.35",
          },
          {
            code: "3188",
            produkt: "Rundstab glatt",
            mass: "5 mm",
            preis: "1.35",
          },
          {
            code: "3189",
            produkt: "Rundstab glatt",
            mass: "6 mm",
            preis: "1.50",
          },
        ],
      },
      {
        name: "Schleifmittel",
        showTitle: true,
        unit: "Stk",
        rows: [
          { code: "3212", produkt: "Excenter", mass: "Korn 60", preis: "2.00" },
          { code: "3213", produkt: "Excenter", mass: "Korn 80", preis: "1.50" },
          {
            code: "3214",
            produkt: "Excenter",
            mass: "Korn 100",
            preis: "2.00",
          },
          {
            code: "3215",
            produkt: "Excenter",
            mass: "Korn 120",
            preis: "1.50",
          },
        ],
      },
      {
        name: "Holzverbinder und Kleinteile",
        showTitle: true,
        unit: "Stk",
        rows: [
          { code: "3242", produkt: "Lamello", mass: "0", preis: "0.10" },
          { code: "3243", produkt: "Lamello", mass: "10", preis: "0.10" },
          { code: "3244", produkt: "Lamello", mass: "20", preis: "0.10" },
          { code: "3245", produkt: "Lamello", mass: "Typ E20L", preis: "0.80" },
        ],
      },
    ],
  };
}

/**
 * Metall: enough categories (incl. a 14-row Bleche table) that the list
 * spills onto a second page and exercises the split/thead-repeat rules.
 */
export function metallPriceList(): PriceListRenderData {
  const bleche = [
    { code: "2060", produkt: "Stahlblech roh", mass: "1.0 mm", preis: "28.00" },
    { code: "2061", produkt: "Stahlblech roh", mass: "1.5 mm", preis: "38.00" },
    { code: "2062", produkt: "Stahlblech roh", mass: "2.0 mm", preis: "48.00" },
    { code: "2063", produkt: "Stahlblech roh", mass: "3.0 mm", preis: "68.00" },
    {
      code: "2064",
      produkt: "Stahlblech verzinkt",
      mass: "1.0 mm",
      preis: "34.00",
    },
    {
      code: "2065",
      produkt: "Stahlblech verzinkt",
      mass: "1.5 mm",
      preis: "45.00",
    },
    {
      code: "2066",
      produkt: "Stahlblech verzinkt",
      mass: "2.0 mm",
      preis: "56.00",
    },
    { code: "2067", produkt: "Aluminiumblech", mass: "1.0 mm", preis: "42.00" },
    { code: "2068", produkt: "Aluminiumblech", mass: "1.5 mm", preis: "54.00" },
    { code: "2069", produkt: "Aluminiumblech", mass: "2.0 mm", preis: "66.00" },
    { code: "2070", produkt: "Aluminiumblech", mass: "3.0 mm", preis: "88.00" },
    {
      code: "2071",
      produkt: "Chromstahlblech",
      mass: "1.0 mm",
      preis: "78.00",
    },
    {
      code: "2072",
      produkt: "Chromstahlblech",
      mass: "1.5 mm",
      preis: "96.00",
    },
    {
      code: "2073",
      produkt: "Chromstahlblech",
      mass: "2.0 mm",
      preis: "118.00",
    },
  ];
  return {
    title: "Metall",
    color: "#8baddc",
    stand: "14.07.2026",
    qrUrl: "https://checkout.example.com/visit/add/list/metall-1",
    categories: [
      {
        name: "Flachstahl",
        showTitle: true,
        unit: "lfm",
        rows: [
          {
            code: "2001",
            produkt: "Flachstahl",
            mass: "15 × 2 mm",
            preis: "1.95",
          },
          {
            code: "2002",
            produkt: "Flachstahl",
            mass: "20 × 3 mm",
            preis: "1.90",
          },
          {
            code: "2003",
            produkt: "Flachstahl",
            mass: "25 × 3 mm",
            preis: "4.75",
          },
          {
            code: "2004",
            produkt: "Flachstahl",
            mass: "30 × 3 mm",
            preis: "5.75",
          },
          {
            code: "2005",
            produkt: "Flachstahl",
            mass: "40 × 4 mm",
            preis: "7.20",
          },
          {
            code: "2006",
            produkt: "Flachstahl",
            mass: "50 × 5 mm",
            preis: "9.80",
          },
          {
            code: "2007",
            produkt: "Flachstahl",
            mass: "60 × 6 mm",
            preis: "12.40",
          },
          {
            code: "2008",
            produkt: "Flachstahl",
            mass: "80 × 8 mm",
            preis: "18.90",
          },
        ],
      },
      {
        name: "Rundstahl",
        showTitle: true,
        unit: "lfm",
        rows: [
          {
            code: "2020",
            produkt: "Rundstahl blank",
            mass: "Ø 6 mm",
            preis: "1.60",
          },
          {
            code: "2021",
            produkt: "Rundstahl blank",
            mass: "Ø 8 mm",
            preis: "2.10",
          },
          {
            code: "2022",
            produkt: "Rundstahl blank",
            mass: "Ø 10 mm",
            preis: "2.90",
          },
          {
            code: "2023",
            produkt: "Rundstahl blank",
            mass: "Ø 12 mm",
            preis: "3.80",
          },
          {
            code: "2024",
            produkt: "Rundstahl blank",
            mass: "Ø 16 mm",
            preis: "6.10",
          },
          {
            code: "2025",
            produkt: "Rundstahl blank",
            mass: "Ø 20 mm",
            preis: "9.20",
          },
        ],
      },
      {
        name: "Vierkant- und Rechteckrohr",
        showTitle: true,
        unit: "lfm",
        rows: [
          {
            code: "2040",
            produkt: "Vierkantrohr",
            mass: "20 × 20 × 2 mm",
            preis: "4.10",
          },
          {
            code: "2041",
            produkt: "Vierkantrohr",
            mass: "25 × 25 × 2 mm",
            preis: "4.90",
          },
          {
            code: "2042",
            produkt: "Vierkantrohr",
            mass: "30 × 30 × 2 mm",
            preis: "5.80",
          },
          {
            code: "2043",
            produkt: "Rechteckrohr",
            mass: "40 × 20 × 2 mm",
            preis: "5.90",
          },
          {
            code: "2044",
            produkt: "Rechteckrohr",
            mass: "50 × 30 × 2 mm",
            preis: "7.40",
          },
          {
            code: "2045",
            produkt: "Rechteckrohr",
            mass: "60 × 40 × 3 mm",
            preis: "10.60",
          },
        ],
      },
      { name: "Bleche", showTitle: true, unit: "m²", rows: bleche },
      {
        name: "Schweissen und Verbrauch",
        showTitle: true,
        unit: "Stk",
        rows: [
          {
            code: "2090",
            produkt: "Schweisselektrode",
            mass: "2.5 mm",
            preis: "0.30",
          },
          {
            code: "2091",
            produkt: "Trennscheibe",
            mass: "125 mm",
            preis: "1.80",
          },
          {
            code: "2092",
            produkt: "Schruppscheibe",
            mass: "125 mm",
            preis: "2.40",
          },
          {
            code: "2093",
            produkt: "Fächerscheibe",
            mass: "125 mm",
            preis: "3.20",
          },
        ],
      },
    ],
  };
}

/**
 * Keramik: exactly one category — its name becomes the page title and the
 * duplicate table heading is suppressed (showTitle: false).
 */
export function keramikPriceList(): PriceListRenderData {
  return {
    title: "Tone",
    color: "#f39a83",
    stand: "14.07.2026",
    qrUrl: "https://checkout.example.com/visit/add/list/keramik-1",
    categories: [
      {
        name: "Tone",
        showTitle: false,
        unit: "kg",
        rows: [
          { code: "4216", produkt: "B128", mass: "", preis: "3.25" },
          { code: "4217", produkt: "B128 CHF", mass: "", preis: "3.55" },
          { code: "4218", produkt: "B128 CH", mass: "", preis: "3.45" },
          { code: "4219", produkt: "GECH 30 F", mass: "", preis: "3.15" },
        ],
      },
    ],
  };
}

/**
 * A single 60-row category: forces repeated splits so the min-3-rows
 * orphan/widow budget and the repeated table head are exercised.
 */
export function longSingleCategoryPriceList(): PriceListRenderData {
  const rows = [];
  for (let i = 0; i < 60; i++) {
    rows.push({
      code: `5${String(i + 1).padStart(3, "0")}`,
      produkt: `Material ${i + 1} – ein etwas längerer Beschreibungstext zum Testen`,
      mass: `${(i % 9) + 1} mm`,
      preis: (10 + i).toFixed(2),
    });
  }
  return {
    title: "Sperrholz",
    color: "#a44d6e",
    stand: "14.07.2026",
    qrUrl: "https://checkout.example.com/visit/add/list/makerspace-1",
    categories: [{ name: "Sperrholz", showTitle: false, unit: "m²", rows }],
  };
}
