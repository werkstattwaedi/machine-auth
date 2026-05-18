// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview Regression coverage for `runImport` — the CognitoForms
 * orchestrator. Stubs the REST client with in-memory fixtures so we can
 * exercise dedupe, item writes, and cursor advance without needing the
 * live API.
 */

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import {
  clearFirestore,
  getFirestore,
  setupEmulator,
  teardownEmulator,
} from "../emulator-helper";
import { CognitoformsClient } from "../../src/import/cognitoforms/api_client";
import {
  COGNITOFORMS_FORM_ID,
  SYNC_DOC_PATH,
  runImport,
} from "../../src/import/cognitoforms/run_import";
import type { CfEntry } from "../../src/import/cognitoforms/schema_types";

// `COGNITOFORMS_CATALOG_IDS` are now real Firestore-shaped IDs that
// match the seeded catalog entries in
// `scripts/seed-data/catalog/machines.json` and `makerspace.json`. The
// test doesn't read the catalog itself (the orchestrator only stores
// DocumentReferences on the imported items), so we don't seed it here.

function loadFixture(name: string): CfEntry {
  // After tsc: this file lives at lib/test/integration/...; fixtures at
  // src/import/cognitoforms/__fixtures__/ — 3 levels up to functions/.
  const p = path.join(
    __dirname,
    "../../../src/import/cognitoforms/__fixtures__",
    name,
  );
  return JSON.parse(fs.readFileSync(p, "utf-8")) as CfEntry;
}

class StubClient extends CognitoformsClient {
  private readonly entries: CfEntry[];
  public listCalls = 0;

  constructor(entries: CfEntry[]) {
    super({ apiKey: "stub", fetchImpl: (async () => {
      throw new Error("StubClient must not call fetch");
    }) as unknown as typeof fetch });
    this.entries = entries;
  }

  async listEntries(): Promise<CfEntry[]> {
    this.listCalls += 1;
    return this.entries;
  }
}

async function seedPricingConfig(): Promise<void> {
  await getFirestore().doc("config/pricing").set({
    entryFees: {
      erwachsen: {
        regular: 5,
        ermaessigt: 2.5,
        materialbezug: 0,
        intern: 0,
        hangenmoos: 0,
      },
      kind: {
        regular: 2.5,
        ermaessigt: 1.25,
        materialbezug: 0,
        intern: 0,
        hangenmoos: 0,
      },
      firma: {
        regular: 5,
        ermaessigt: 2.5,
        materialbezug: 0,
        intern: 0,
        hangenmoos: 0,
      },
    },
  });
}

describe("CognitoForms importer (integration)", function () {
  this.timeout(20000);

  before(async () => {
    await setupEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
    await seedPricingConfig();
  });

  after(async () => {
    await teardownEmulator();
  });

  it("imports a regular checkout and writes items + summary", async () => {
    const entry = loadFixture("entry-regular-single.json");
    const client = new StubClient([entry]);

    const result = await runImport({ client, formId: COGNITOFORMS_FORM_ID });

    expect(result.importedCount).to.equal(1);
    expect(result.skippedDuplicates).to.equal(0);

    const db = getFirestore();
    const doc = await db.doc("checkouts/zzCognitoForms001001").get();
    expect(doc.exists).to.be.true;
    const data = doc.data() as Record<string, unknown>;
    expect(data.status).to.equal("closed");
    expect(data.usageType).to.equal("regular");
    expect((data.summary as { totalPrice: number }).totalPrice).to.equal(38.5);

    const items = await doc.ref.collection("items").get();
    expect(items.size).to.equal(2);

    const cursor = await db.doc(SYNC_DOC_PATH).get();
    expect(cursor.exists).to.be.true;
    expect((cursor.data() as { lastRunStatus?: string }).lastRunStatus).to.equal("ok");
    expect((cursor.data() as { importedCount?: number }).importedCount).to.equal(1);
  });

  it("is idempotent — running twice with the same fixture writes once", async () => {
    const entry = loadFixture("entry-regular-single.json");
    const first = await runImport({ client: new StubClient([entry]) });
    const second = await runImport({ client: new StubClient([entry]) });

    expect(first.importedCount).to.equal(1);
    expect(second.importedCount).to.equal(0);
    expect(second.skippedDuplicates).to.equal(1);

    const items = await getFirestore()
      .doc("checkouts/zzCognitoForms001001")
      .collection("items")
      .get();
    expect(items.size).to.equal(2);
  });

  it("handles intern / kulturlegi / materialbezug / firma fixtures together", async () => {
    const entries = [
      loadFixture("entry-regular-single.json"),
      loadFixture("entry-intern.json"),
      loadFixture("entry-kulturlegi.json"),
      loadFixture("entry-materialbezug.json"),
      loadFixture("entry-firma-sandstrahl.json"),
    ];
    const client = new StubClient(entries);

    const result = await runImport({ client });

    expect(result.importedCount).to.equal(5);

    const db = getFirestore();
    const checkpoint = async (id: string) =>
      (await db.doc(`checkouts/${id}`).get()).data() as Record<string, unknown>;

    const ck1001 = await checkpoint("zzCognitoForms001001");
    expect(ck1001.usageType).to.equal("regular");
    const ck1002 = await checkpoint("zzCognitoForms001002");
    expect(ck1002.usageType).to.equal("intern");
    // Intern checkout summary zeros out machine + material cost
    expect((ck1002.summary as { totalPrice: number }).totalPrice).to.equal(0);
    const ck1003 = await checkpoint("zzCognitoForms001003");
    expect(ck1003.usageType).to.equal("ermaessigt");
    const ck1004 = await checkpoint("zzCognitoForms001004");
    expect(ck1004.usageType).to.equal("materialbezug");
    const ck1005 = await checkpoint("zzCognitoForms001005");
    expect(ck1005.usageType).to.equal("regular");
    const firmaItems = await db
      .doc(`checkouts/zzCognitoForms001005`)
      .collection("items")
      .get();
    expect(firmaItems.size).to.equal(2);
  });

  it("advances the cursor to the latest Entry.DateSubmitted", async () => {
    const entries = [
      loadFixture("entry-regular-single.json"), // 2026-05-01
      loadFixture("entry-firma-sandstrahl.json"), // 2026-05-05
    ];
    await runImport({ client: new StubClient(entries) });

    const cursor = (await getFirestore().doc(SYNC_DOC_PATH).get()).data() as {
      lastEntryDateSubmitted: { toDate(): Date };
    };
    const cursorIso = cursor.lastEntryDateSubmitted.toDate().toISOString();
    expect(cursorIso).to.equal("2026-05-05T12:00:00.000Z");
  });
});
