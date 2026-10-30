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
        priceColumns: [{ heading: "pro m²" }],
        rows: [
          { code: "3001", produkt: "Ahorn", mass: "24 mm", prices: ["62.30"] },
          { code: "3002", produkt: "Ahorn", mass: "30 mm", prices: ["77.85"] },
          { code: "3003", produkt: "Ahorn", mass: "40 mm", prices: ["103.80"] },
          { code: "3004", produkt: "Ahorn", mass: "50 mm", prices: ["129.75"] },
        ],
      },
      {
        name: "Holzplatten",
        showTitle: true,
        priceColumns: [{ heading: "pro m²" }],
        rows: [
          {
            code: "3156",
            produkt: "3-Schichtplatte, Fichte",
            mass: "19 mm",
            prices: ["34.80"],
          },
          {
            code: "3157",
            produkt: "3-Schichtplatte, Fichte",
            mass: "27 mm",
            prices: ["38.65"],
          },
          {
            code: "3158",
            produkt: "1-Schichtplatte, Fichte",
            mass: "18 mm",
            prices: ["47.80"],
          },
          {
            code: "3159",
            produkt: "1-Schichtplatte, Fichte",
            mass: "21 mm",
            prices: ["49.60"],
          },
        ],
      },
      {
        name: "Rundstäbe",
        showTitle: true,
        priceColumns: [{ heading: "pro lfm" }],
        rows: [
          {
            code: "3186",
            produkt: "Rundstab glatt",
            mass: "3 mm",
            prices: ["1.40"],
          },
          {
            code: "3187",
            produkt: "Rundstab glatt",
            mass: "4 mm",
            prices: ["1.35"],
          },
          {
            code: "3188",
            produkt: "Rundstab glatt",
            mass: "5 mm",
            prices: ["1.35"],
          },
          {
            code: "3189",
            produkt: "Rundstab glatt",
            mass: "6 mm",
            prices: ["1.50"],
          },
        ],
      },
      {
        name: "Schleifmittel",
        showTitle: true,
        priceColumns: [{ heading: "pro Stk" }],
        rows: [
          { code: "3212", produkt: "Excenter", mass: "Korn 60", prices: ["2.00"] },
          { code: "3213", produkt: "Excenter", mass: "Korn 80", prices: ["1.50"] },
          {
            code: "3214",
            produkt: "Excenter",
            mass: "Korn 100",
            prices: ["2.00"],
          },
          {
            code: "3215",
            produkt: "Excenter",
            mass: "Korn 120",
            prices: ["1.50"],
          },
        ],
      },
      {
        name: "Holzverbinder und Kleinteile",
        showTitle: true,
        priceColumns: [{ heading: "pro Stk" }],
        rows: [
          { code: "3242", produkt: "Lamello", mass: "0", prices: ["0.10"] },
          { code: "3243", produkt: "Lamello", mass: "10", prices: ["0.10"] },
          { code: "3244", produkt: "Lamello", mass: "20", prices: ["0.10"] },
          { code: "3245", produkt: "Lamello", mass: "Typ E20L", prices: ["0.80"] },
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
    { code: "2060", produkt: "Stahlblech roh", mass: "1.0 mm", prices: ["28.00"] },
    { code: "2061", produkt: "Stahlblech roh", mass: "1.5 mm", prices: ["38.00"] },
    { code: "2062", produkt: "Stahlblech roh", mass: "2.0 mm", prices: ["48.00"] },
    { code: "2063", produkt: "Stahlblech roh", mass: "3.0 mm", prices: ["68.00"] },
    {
      code: "2064",
      produkt: "Stahlblech verzinkt",
      mass: "1.0 mm",
      prices: ["34.00"],
    },
    {
      code: "2065",
      produkt: "Stahlblech verzinkt",
      mass: "1.5 mm",
      prices: ["45.00"],
    },
    {
      code: "2066",
      produkt: "Stahlblech verzinkt",
      mass: "2.0 mm",
      prices: ["56.00"],
    },
    { code: "2067", produkt: "Aluminiumblech", mass: "1.0 mm", prices: ["42.00"] },
    { code: "2068", produkt: "Aluminiumblech", mass: "1.5 mm", prices: ["54.00"] },
    { code: "2069", produkt: "Aluminiumblech", mass: "2.0 mm", prices: ["66.00"] },
    { code: "2070", produkt: "Aluminiumblech", mass: "3.0 mm", prices: ["88.00"] },
    {
      code: "2071",
      produkt: "Chromstahlblech",
      mass: "1.0 mm",
      prices: ["78.00"],
    },
    {
      code: "2072",
      produkt: "Chromstahlblech",
      mass: "1.5 mm",
      prices: ["96.00"],
    },
    {
      code: "2073",
      produkt: "Chromstahlblech",
      mass: "2.0 mm",
      prices: ["118.00"],
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
        priceColumns: [{ heading: "pro lfm" }],
        rows: [
          {
            code: "2001",
            produkt: "Flachstahl",
            mass: "15 × 2 mm",
            prices: ["1.95"],
          },
          {
            code: "2002",
            produkt: "Flachstahl",
            mass: "20 × 3 mm",
            prices: ["1.90"],
          },
          {
            code: "2003",
            produkt: "Flachstahl",
            mass: "25 × 3 mm",
            prices: ["4.75"],
          },
          {
            code: "2004",
            produkt: "Flachstahl",
            mass: "30 × 3 mm",
            prices: ["5.75"],
          },
          {
            code: "2005",
            produkt: "Flachstahl",
            mass: "40 × 4 mm",
            prices: ["7.20"],
          },
          {
            code: "2006",
            produkt: "Flachstahl",
            mass: "50 × 5 mm",
            prices: ["9.80"],
          },
          {
            code: "2007",
            produkt: "Flachstahl",
            mass: "60 × 6 mm",
            prices: ["12.40"],
          },
          {
            code: "2008",
            produkt: "Flachstahl",
            mass: "80 × 8 mm",
            prices: ["18.90"],
          },
        ],
      },
      {
        name: "Rundstahl",
        showTitle: true,
        priceColumns: [{ heading: "pro lfm" }],
        rows: [
          {
            code: "2020",
            produkt: "Rundstahl blank",
            mass: "Ø 6 mm",
            prices: ["1.60"],
          },
          {
            code: "2021",
            produkt: "Rundstahl blank",
            mass: "Ø 8 mm",
            prices: ["2.10"],
          },
          {
            code: "2022",
            produkt: "Rundstahl blank",
            mass: "Ø 10 mm",
            prices: ["2.90"],
          },
          {
            code: "2023",
            produkt: "Rundstahl blank",
            mass: "Ø 12 mm",
            prices: ["3.80"],
          },
          {
            code: "2024",
            produkt: "Rundstahl blank",
            mass: "Ø 16 mm",
            prices: ["6.10"],
          },
          {
            code: "2025",
            produkt: "Rundstahl blank",
            mass: "Ø 20 mm",
            prices: ["9.20"],
          },
        ],
      },
      {
        name: "Vierkant- und Rechteckrohr",
        showTitle: true,
        priceColumns: [{ heading: "pro lfm" }],
        rows: [
          {
            code: "2040",
            produkt: "Vierkantrohr",
            mass: "20 × 20 × 2 mm",
            prices: ["4.10"],
          },
          {
            code: "2041",
            produkt: "Vierkantrohr",
            mass: "25 × 25 × 2 mm",
            prices: ["4.90"],
          },
          {
            code: "2042",
            produkt: "Vierkantrohr",
            mass: "30 × 30 × 2 mm",
            prices: ["5.80"],
          },
          {
            code: "2043",
            produkt: "Rechteckrohr",
            mass: "40 × 20 × 2 mm",
            prices: ["5.90"],
          },
          {
            code: "2044",
            produkt: "Rechteckrohr",
            mass: "50 × 30 × 2 mm",
            prices: ["7.40"],
          },
          {
            code: "2045",
            produkt: "Rechteckrohr",
            mass: "60 × 40 × 3 mm",
            prices: ["10.60"],
          },
        ],
      },
      { name: "Bleche", showTitle: true, priceColumns: [{ heading: "pro m²" }], rows: bleche },
      {
        name: "Schweissen und Verbrauch",
        showTitle: true,
        priceColumns: [{ heading: "pro Stk" }],
        rows: [
          {
            code: "2090",
            produkt: "Schweisselektrode",
            mass: "2.5 mm",
            prices: ["0.30"],
          },
          {
            code: "2091",
            produkt: "Trennscheibe",
            mass: "125 mm",
            prices: ["1.80"],
          },
          {
            code: "2092",
            produkt: "Schruppscheibe",
            mass: "125 mm",
            prices: ["2.40"],
          },
          {
            code: "2093",
            produkt: "Fächerscheibe",
            mass: "125 mm",
            prices: ["3.20"],
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
        priceColumns: [{ heading: "pro kg" }],
        rows: [
          { code: "4216", produkt: "B128", mass: "", prices: ["3.25"] },
          { code: "4217", produkt: "B128 CHF", mass: "", prices: ["3.55"] },
          { code: "4218", produkt: "B128 CH", mass: "", prices: ["3.45"] },
          { code: "4219", produkt: "GECH 30 F", mass: "", prices: ["3.15"] },
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
      prices: [(10 + i).toFixed(2)],
    });
  }
  return {
    title: "Sperrholz",
    color: "#a44d6e",
    stand: "14.07.2026",
    qrUrl: "https://checkout.example.com/visit/add/list/makerspace-1",
    categories: [{ name: "Sperrholz", showTitle: false, priceColumns: [{ heading: "pro m²" }], rows }],
  };
}

/**
 * Laser (real catalog shape, prices as printed in the Makerspace list): the
 * four-price tables shrink Mass and prices so long product names wrap, a row
 * lacking a format prints a dash, and single-price tables keep the full layout.
 */
export function laserPriceList(): PriceListRenderData {
  const sperrholz: [string, string, string, string, string, string, string][] = [
    ["6001", "Sperrholz Linde", "2 mm", "3.00", "–", "–", "24.00"],
    ["6002", "Sperrholz Linde", "3 mm", "3.90", "–", "–", "31.00"],
    ["6005", "Sperrholz Pappel", "3 mm", "2.00", "3.15", "9.95", "15.90"],
    ["6010", "Sperrholz Pappel", "12 mm", "5.35", "8.40", "26.45", "42.34"],
    ["6016", "Sperrholz Seekiefer", "12 mm", "3.35", "5.30", "16.70", "26.70"],
  ];
  const acryl: [string, string, string, string, string, string, string][] = [
    ["6102", "Acryl transparent farblos", "2 mm", "0.90", "11.10", "44.00", "88.00"],
    ["6104", "Acryl transparent farblos", "4 mm", "1.10", "14.10", "56.00", "112.00"],
    ["6107", "Acryl transparent farblos", "8 mm", "2.15", "26.95", "107.00", "214.00"],
    ["6109", "Acryl weiss milchig lichtdurchlässig (opal)", "3 mm", "0.95", "12.05", "47.75", "95.50"],
    ["6112", "Acryl zitronengelb lichtdurchlässig (opal)", "3 mm", "0.95", "12.05", "47.75", "95.50"],
  ];
  const rows = (table: typeof sperrholz) =>
    table.map(([code, produkt, mass, ...prices]) => ({
      code,
      produkt,
      mass,
      prices: prices.map((p) => (p === "–" ? null : p)),
    }));
  return {
    title: "Laser",
    color: "#a44d6e",
    stand: "14.07.2026",
    qrUrl: "https://checkout.example.com/visit/add/list/laser-1",
    categories: [
      {
        name: "Sperrholz",
        showTitle: true,
        priceColumns: [
          { heading: "A3" },
          { heading: "320 × 620 mm" },
          { heading: "500 × 1250 mm" },
          { heading: "pro m²" },
        ],
        rows: rows(sperrholz),
      },
      {
        name: "Acryl gegossen",
        showTitle: true,
        priceColumns: [
          { heading: "100 × 100 mm" },
          { heading: "A3" },
          { heading: "500 × 1000 mm" },
          { heading: "pro m²" },
        ],
        rows: rows(acryl),
      },
      {
        name: "Stempel",
        showTitle: true,
        priceColumns: [{ heading: "pro Stk" }],
        rows: [
          { code: "6301", produkt: "Stempelgummi Aero", mass: "A4", prices: ["37.00"] },
          { code: "6302", produkt: "EZ mount Klebeband", mass: "A4", prices: ["10.00"] },
        ],
      },
    ],
  };
}

/** Five price columns: the most a table may have, with its headings wrapping. */
export function maxColumnsPriceList(): PriceListRenderData {
  const data = laserPriceList();
  data.categories = [
    {
      name: "Sperrholz",
      showTitle: true,
      priceColumns: [
        { heading: "100 × 100 mm" },
        { heading: "A3" },
        { heading: "320 × 620 mm" },
        { heading: "500 × 1250 mm" },
        { heading: "pro m²" },
      ],
      rows: [
        { code: "6005", produkt: "Sperrholz Pappel", mass: "12 mm", prices: ["0.45", "5.35", "8.40", "26.45", "42.34"] },
        { code: "6109", produkt: "Acryl weiss milchig lichtdurchlässig (opal)", mass: "3 mm", prices: ["0.95", "12.05", "18.95", "59.70", "95.50"] },
      ],
    },
  ];
  return data;
}
