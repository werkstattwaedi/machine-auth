// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { handleUpsertCatalogItem } from "../../src/catalog/upsert_catalog_item";

const ADMIN_UID = "admin-test";

const baseInput = {
  code: "3001",
  name: "Test Material",
  description: null,
  workshops: ["holz"],
  category: ["Holz"],
  active: true,
  userCanAdd: true,
  variants: [
    {
      id: "default",
      pricingModel: "count",
      unitPrice: { default: 1.5, member: 1.2 },
    },
  ],
};

async function expectHttpsError(
  fn: () => Promise<unknown>,
  expectedCode: string
): Promise<void> {
  try {
    await fn();
    throw new Error(`expected HttpsError with code=${expectedCode}, got success`);
  } catch (err: any) {
    if (err?.code !== expectedCode) {
      throw new Error(
        `expected HttpsError code=${expectedCode}, got ${err?.code ?? "unknown"}: ${err?.message}`
      );
    }
  }
}

describe("upsertCatalogItem (Integration)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
  });

  it("creates a catalog item with auto-generated id", async () => {
    const { id } = await handleUpsertCatalogItem(baseInput, ADMIN_UID);
    expect(id).to.be.a("string").and.have.length.greaterThan(0);

    const snap = await getFirestore().collection("catalog").doc(id).get();
    expect(snap.exists).to.be.true;
    const data = snap.data();
    expect(data?.code).to.equal("3001");
    expect(data?.name).to.equal("Test Material");
    expect(data?.modifiedBy).to.equal(ADMIN_UID);
    expect(data?.category).to.deep.equal(["Holz"]);
  });

  it("rejects a create whose code is already taken by a different doc", async () => {
    await handleUpsertCatalogItem(baseInput, ADMIN_UID);
    await expectHttpsError(
      () =>
        handleUpsertCatalogItem(
          { ...baseInput, name: "Duplicate" },
          ADMIN_UID
        ),
      "already-exists"
    );
  });

  it("updates an existing doc by id without colliding with itself", async () => {
    const { id } = await handleUpsertCatalogItem(baseInput, ADMIN_UID);
    await handleUpsertCatalogItem(
      { ...baseInput, id, name: "Renamed", description: "now described" },
      ADMIN_UID
    );

    const snap = await getFirestore().collection("catalog").doc(id).get();
    expect(snap.data()?.name).to.equal("Renamed");
    expect(snap.data()?.description).to.equal("now described");
    expect(snap.data()?.code).to.equal("3001");
  });

  it("preserves category on update when caller omits it", async () => {
    const { id } = await handleUpsertCatalogItem(baseInput, ADMIN_UID);
    const { category: _omit, ...withoutCategory } = baseInput;
    void _omit;
    await handleUpsertCatalogItem(
      { ...withoutCategory, id, name: "Untouched category" },
      ADMIN_UID
    );

    const snap = await getFirestore().collection("catalog").doc(id).get();
    expect(snap.data()?.category).to.deep.equal(["Holz"]);
  });

  it("rejects an update that would clash with another doc's code", async () => {
    const { id: idA } = await handleUpsertCatalogItem(
      { ...baseInput, code: "A100" },
      ADMIN_UID
    );
    void idA;
    const { id: idB } = await handleUpsertCatalogItem(
      { ...baseInput, code: "B200" },
      ADMIN_UID
    );

    await expectHttpsError(
      () =>
        handleUpsertCatalogItem(
          { ...baseInput, id: idB, code: "A100" },
          ADMIN_UID
        ),
      "already-exists"
    );
  });

  it("rejects update for a non-existent id", async () => {
    await expectHttpsError(
      () =>
        handleUpsertCatalogItem(
          { ...baseInput, id: "does-not-exist" },
          ADMIN_UID
        ),
      "not-found"
    );
  });

  it("defaults category to ['Sonstiges'] on create when caller omits it", async () => {
    const { category: _omit, ...withoutCategory } = baseInput;
    void _omit;
    const { id } = await handleUpsertCatalogItem(withoutCategory, ADMIN_UID);
    const snap = await getFirestore().collection("catalog").doc(id).get();
    expect(snap.data()?.category).to.deep.equal(["Sonstiges"]);
  });

  it("rejects malformed input", async () => {
    await expectHttpsError(
      () => handleUpsertCatalogItem({ code: 123 }, ADMIN_UID),
      "invalid-argument"
    );
  });

  it("stores the full variants array verbatim (base + cut options)", async () => {
    const withCuts = {
      ...baseInput,
      code: "6001",
      variants: [
        { id: "m2", label: "Per m²", pricingModel: "area", unitPrice: { default: 5.55 } },
        { id: "a3", label: "Zuschnitt A3", pricingModel: "count", unitPrice: { default: 0.7 } },
      ],
    };
    const { id } = await handleUpsertCatalogItem(withCuts, ADMIN_UID);
    const snap = await getFirestore().collection("catalog").doc(id).get();
    expect(snap.data()?.variants).to.deep.equal(withCuts.variants);
    expect(snap.data()?.variantIds).to.equal(undefined);
  });
});
