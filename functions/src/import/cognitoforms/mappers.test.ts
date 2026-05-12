// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import {
  checkoutIdForEntry,
  derivedUsageType,
  inferPricingModelFromKategorie,
  mapEntryToCheckout,
  mapFdmFilamentRow,
  mapNutzungSingular,
  mapPerson,
  mapSandstrahlenRow,
  stripPersonInternals,
} from "./mappers";
import type { CfEntry } from "./schema_types";

// __dirname after tsc lands at `functions/lib/src/import/cognitoforms/`.
// Four levels up reaches the `functions/` root, then back into `src/...`
// where the JSON fixtures live (TS doesn't copy them into lib/).
function loadFixture(name: string): CfEntry {
  const p = path.join(
    __dirname,
    "../../../../src/import/cognitoforms/__fixtures__",
    name,
  );
  return JSON.parse(fs.readFileSync(p, "utf-8")) as CfEntry;
}

describe("checkoutIdForEntry", () => {
  it("builds zzCognitoFormsNNNNNN from Entry.Number", () => {
    expect(
      checkoutIdForEntry({ Entry: { Number: 42 } } as CfEntry),
    ).to.equal("zzCognitoForms000042");
  });
  it("pads 6 digits", () => {
    expect(
      checkoutIdForEntry({ Entry: { Number: 1234 } } as CfEntry),
    ).to.equal("zzCognitoForms001234");
  });
  it("throws on missing Entry.Number", () => {
    expect(() => checkoutIdForEntry({} as CfEntry)).to.throw(
      /Entry\.Number/,
    );
  });
});

describe("inferPricingModelFromKategorie", () => {
  it("m2 → area", () => {
    expect(inferPricingModelFromKategorie("m2 (Platten…)")).to.equal("area");
  });
  it("m → length", () => {
    expect(inferPricingModelFromKategorie("m (Latten…)")).to.equal("length");
  });
  it("kg → weight", () => {
    expect(inferPricingModelFromKategorie("kg (Ton…)")).to.equal("weight");
  });
  it("g → weight", () => {
    expect(inferPricingModelFromKategorie("g (Silber…)")).to.equal("weight");
  });
  it("Stk → count", () => {
    expect(inferPricingModelFromKategorie("Stk. (Verbrauchsmaterial)")).to.equal(
      "count",
    );
  });
  it("unknown → null", () => {
    expect(inferPricingModelFromKategorie("Sonstiges")).to.be.null;
  });
});

describe("mapNutzungSingular", () => {
  it("returns null when AnzahlStunden is zero", () => {
    expect(
      mapNutzungSingular(
        { AnzahlStunden: 0, Zwischentotal: 0 },
        {
          workshop: "holz",
          description: "Stationäre Maschinen",
          catalogKey: "stationaereMaschinen",
        },
      ),
    ).to.be.null;
  });
  it("builds a time-priced item with derived unitPrice", () => {
    const item = mapNutzungSingular(
      { AnzahlStunden: 2, Zwischentotal: 20, Rabatt: "Nein" },
      {
        workshop: "holz",
        description: "Stationäre Maschinen",
        catalogKey: "stationaereMaschinen",
      },
    );
    expect(item).not.to.be.null;
    expect(item!.workshop).to.equal("holz");
    expect(item!.pricingModel).to.equal("time");
    expect(item!.quantity).to.equal(2);
    expect(item!.unitPrice).to.equal(10);
    expect(item!.totalPrice).to.equal(20);
    expect(item!.description).to.equal("Stationäre Maschinen");
  });
  it("appends Rabatt to the description when not Nein", () => {
    const item = mapNutzungSingular(
      { AnzahlStunden: 1, Zwischentotal: 5, Rabatt: "Mitglied OWW" },
      {
        workshop: "holz",
        description: "Drechselbank",
        catalogKey: "drechselbank",
      },
    );
    expect(item!.description).to.equal("Drechselbank (Rabatt: Mitglied OWW)");
  });
});

describe("mapSandstrahlenRow", () => {
  it("builds a count-priced item with Grösse in description", () => {
    const item = mapSandstrahlenRow(
      {
        Anzahl: 2,
        Grösse: "Klein (bis 13 x 9 x 9 cm)",
        Betrag: 10,
      },
      {
        workshop: "stein",
        descriptionPrefix: "Sandstrahlen",
        catalogKey: "sandstrahlenStein",
      },
    );
    expect(item!.pricingModel).to.equal("count");
    expect(item!.quantity).to.equal(2);
    expect(item!.unitPrice).to.equal(5);
    expect(item!.totalPrice).to.equal(10);
    expect(item!.description).to.contain("Klein");
  });
});

describe("mapFdmFilamentRow", () => {
  it("dispatches Kategorie 1 to fdmFilamentStandard", () => {
    const item = mapFdmFilamentRow({
      Gewichtg: 100,
      Kategorie: "Kategorie 1 (Standard)",
      Betrag: 5,
    });
    expect(item!.catalogKey).to.equal("fdmFilamentStandard");
    expect(item!.pricingModel).to.equal("weight");
    expect(item!.quantity).to.equal(0.1); // 100g stored as 0.1kg
    expect(item!.totalPrice).to.equal(5);
    expect(item!.unitPrice).to.equal(50); // CHF/kg
    expect(item!.formInputs?.[0]).to.deep.equal({ quantity: 100, unit: "g" });
  });
  it("dispatches Kategorie 3 to fdmFilamentTechnisch", () => {
    const item = mapFdmFilamentRow({
      Gewichtg: 30,
      Kategorie: "Kategorie 3 (Technisch)",
      Betrag: 12,
    });
    expect(item!.catalogKey).to.equal("fdmFilamentTechnisch");
  });
  it("falls back to catalogKey=null on unknown Kategorie (data preserved)", () => {
    const item = mapFdmFilamentRow({
      Gewichtg: 30,
      Kategorie: "Kategorie 99 (Mystery)",
      Betrag: 5,
    });
    expect(item!.catalogKey).to.be.null;
    expect(item!.description).to.contain("Kategorie 99");
  });
});

describe("mapPerson", () => {
  it("maps Erwachsen + Reguläre with no billing address", () => {
    const p = mapPerson({
      Vorname: "Anna",
      Nachname: "Beispiel",
      EMail: "anna@example.com",
      Nutzerin: "Erwachsen",
      Nutzungsart: "Reguläre Nutzung",
    });
    expect(p.name).to.equal("Anna Beispiel");
    expect(p.userType).to.equal("erwachsen");
    expect(p.email).to.equal("anna@example.com");
    expect(p.billingAddress).to.be.undefined;
  });
  it("maps Firma with billing address", () => {
    const p = mapPerson({
      Vorname: "Hans",
      Nachname: "Geschäft",
      EMail: "hans@firma.com",
      Nutzerin: "Firma",
      Nutzungsart: "Reguläre Nutzung",
      Rechnungsadresse2: {
        Firma: "ACME AG",
        FirmaZusatz: "Werkstatt",
        StrasseNr: "Musterstrasse 1",
        AdresseZusatz: "c/o X",
        PLZ: "8000",
        Ort: "Zürich",
      },
    });
    expect(p.userType).to.equal("firma");
    expect(p.billingAddress).to.deep.equal({
      company: "ACME AG — Werkstatt",
      street: "Musterstrasse 1, c/o X",
      zip: "8000",
      city: "Zürich",
    });
  });
  it("maps Kind to kind", () => {
    const p = mapPerson({
      Vorname: "Tim",
      Nachname: "Junior",
      Nutzerin: "Kind (u. 18)",
      Nutzungsart: "Reguläre Nutzung",
    });
    expect(p.userType).to.equal("kind");
  });
});

describe("derivedUsageType (precedence)", () => {
  function person(art: string) {
    return mapPerson({
      Vorname: "X",
      Nachname: "Y",
      Nutzerin: "Erwachsen",
      Nutzungsart: art as any,
    });
  }
  it("hangenmoos wins over everything", () => {
    expect(
      derivedUsageType(
        [person("Reguläre Nutzung"), person("Hangenmoos AG")],
        [],
      ),
    ).to.equal("hangenmoos");
  });
  it("intern beats ermaessigt/materialbezug/regular", () => {
    expect(
      derivedUsageType(
        [person("Ermässigte Nutzung (KulturLegi)"), person("Interne Nutzung")],
        [],
      ),
    ).to.equal("intern");
  });
  it("all-materialbezug with no machine items → materialbezug", () => {
    expect(
      derivedUsageType([person("Nur Materialbezug")], []),
    ).to.equal("materialbezug");
  });
  it("all-materialbezug WITH machine items → regular (not materialbezug)", () => {
    expect(
      derivedUsageType(
        [person("Nur Materialbezug")],
        [
          {
            workshop: "holz",
            description: "x",
            origin: "manual",
            catalogKey: "stationaereMaschinen",
            quantity: 1,
            unitPrice: 1,
            totalPrice: 1,
            pricingModel: "time",
          },
        ],
      ),
    ).to.equal("regular");
  });
  it("any KulturLegi → ermaessigt", () => {
    expect(
      derivedUsageType(
        [
          person("Reguläre Nutzung"),
          person("Ermässigte Nutzung (KulturLegi)"),
        ],
        [],
      ),
    ).to.equal("ermaessigt");
  });
  it("default → regular", () => {
    expect(
      derivedUsageType([person("Reguläre Nutzung")], []),
    ).to.equal("regular");
  });
});

describe("mapEntryToCheckout (fixtures)", () => {
  it("regular-single: one person, machine + material items, regular usageType", () => {
    const entry = loadFixture("entry-regular-single.json");
    const out = mapEntryToCheckout(entry);
    expect(out.docId).to.equal("zzCognitoForms001001");
    expect(out.usageType).to.equal("regular");
    expect(out.persons).to.have.length(1);
    expect(out.persons[0].name).to.equal("Anna Beispiel");
    expect(out.items).to.have.length(2);
    const stat = out.items.find((i) => i.catalogKey === "stationaereMaschinen");
    expect(stat).to.exist;
    expect(stat!.totalPrice).to.equal(20);
    expect(stat!.description).to.contain("Mitglied OWW");
    const wood = out.items.find((i) => i.workshop === "holz" && i.catalogKey == null);
    expect(wood).to.exist;
    expect(wood!.pricingModel).to.equal("area");
    expect(wood!.totalPrice).to.equal(13.5);
    expect(out.sourceTotal).to.equal(38.5);
    expect(out.workshopsVisited).to.deep.equal(["holz"]);
  });

  it("intern: usageType=intern preserved across all persons", () => {
    const entry = loadFixture("entry-intern.json");
    const out = mapEntryToCheckout(entry);
    expect(out.usageType).to.equal("intern");
    expect(out.docId).to.equal("zzCognitoForms001002");
    // Even though Zwischentotal is 0 for the Nutzung block, the screw
    // material row is still imported.
    const screws = out.items.find((i) => i.workshop === "metall");
    expect(screws).to.exist;
    expect(screws!.quantity).to.equal(10);
    expect(screws!.totalPrice).to.equal(5);
  });

  it("kulturlegi: two persons → ermaessigt + two FDM filament rows", () => {
    const entry = loadFixture("entry-kulturlegi.json");
    const out = mapEntryToCheckout(entry);
    expect(out.usageType).to.equal("ermaessigt");
    expect(out.persons).to.have.length(2);
    expect(out.items).to.have.length(2);
    const std = out.items.find((i) => i.catalogKey === "fdmFilamentStandard");
    const tech = out.items.find((i) => i.catalogKey === "fdmFilamentTechnisch");
    expect(std).to.exist;
    expect(std!.totalPrice).to.equal(5);
    expect(tech).to.exist;
    expect(tech!.totalPrice).to.equal(12);
  });

  it("materialbezug: all-material person, no machine items → materialbezug", () => {
    const entry = loadFixture("entry-materialbezug.json");
    const out = mapEntryToCheckout(entry);
    expect(out.usageType).to.equal("materialbezug");
    expect(out.items).to.have.length(2);
    const silber = out.items.find((i) => i.workshop === "schmuck");
    expect(silber).to.exist;
    expect(silber!.pricingModel).to.equal("weight");
    expect(silber!.quantity).to.equal(0.008); // 8g → 0.008 kg
    expect(silber!.totalPrice).to.equal(20);
    const div = out.items.find((i) => i.workshop === "diverses");
    expect(div).to.exist;
    expect(div!.pricingModel).to.equal("direct");
    expect(div!.totalPrice).to.equal(3);
  });

  it("firma-sandstrahl: Firma billing address + two sandstrahl rows", () => {
    const entry = loadFixture("entry-firma-sandstrahl.json");
    const out = mapEntryToCheckout(entry);
    expect(out.persons[0].userType).to.equal("firma");
    expect(out.persons[0].billingAddress).to.exist;
    const sandStein = out.items.find(
      (i) => i.catalogKey === "sandstrahlenStein",
    );
    const sandMet = out.items.find(
      (i) => i.catalogKey === "sandstrahlenMetall",
    );
    expect(sandStein).to.exist;
    expect(sandStein!.totalPrice).to.equal(10);
    expect(sandMet).to.exist;
    expect(sandMet!.totalPrice).to.equal(15);
    expect(out.sourceTotal).to.equal(35);
  });
});

describe("stripPersonInternals", () => {
  it("removes cfNutzungsart before write", () => {
    const p = mapPerson({
      Vorname: "X",
      Nachname: "Y",
      Nutzerin: "Erwachsen",
      Nutzungsart: "Reguläre Nutzung",
    });
    const stripped = stripPersonInternals(p);
    expect((stripped as unknown as Record<string, unknown>).cfNutzungsart).to.be.undefined;
    expect(stripped.name).to.equal("X Y");
  });
});
