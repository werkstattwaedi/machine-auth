// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * End-to-end coverage for the `getPriceListPdfUrl` callable against the
 * real Firestore + Storage emulators: the PDF object actually lands in the
 * bucket, its bytes parse as the designed price list, the content-hash
 * cache reuses the object, and the returned URL serves the bytes (in
 * emulator mode via the download-token URL — production uses signed URLs,
 * whose option shape is covered by unit tests).
 */

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  clearStorage,
  teardownEmulator,
  getFirestore,
  getBucket,
} from "../emulator-helper";
import { getPriceListPdfUrlHandler } from "../../src/price_list/get_price_list_pdf_url";

const pdfParse = require("pdf-parse") as (
  buffer: Buffer,
) => Promise<{ text: string; numpages: number }>;

interface SeedItemOptions {
  code: string;
  labelName: string;
  labelMass?: string;
  workshops?: string[];
  category?: string[];
  price?: number;
}

async function seedCatalogItem(
  itemId: string,
  opts: SeedItemOptions,
): Promise<void> {
  const db = getFirestore();
  await db.doc(`catalog/${itemId}`).set({
    code: opts.code,
    name: `${opts.labelName} ${opts.labelMass ?? ""}`.trim(),
    labelName: opts.labelName,
    labelMass: opts.labelMass ?? "",
    workshops: opts.workshops ?? ["holz"],
    category: opts.category ?? ["Massivholz"],
    active: true,
    userCanAdd: true,
    variants: [
      {
        id: "base",
        label: null,
        pricingModel: "area",
        unitPrice: { default: opts.price ?? 62.3 },
      },
    ],
  });
}

async function seedPriceList(listId: string, items: string[]): Promise<void> {
  const db = getFirestore();
  await db.doc(`price_lists/${listId}`).set({
    name: "Holz Aushang",
    items,
    active: true,
  });
}

function buildRequest(
  data: Record<string, unknown>,
  opts: { auth?: boolean; admin?: boolean } = { auth: true, admin: true },
): CallableRequest<unknown> {
  const auth = opts.auth
    ? { uid: "admin-user", token: opts.admin ? { admin: true } : {} }
    : undefined;
  return { data, auth } as unknown as CallableRequest<unknown>;
}

async function callHandler(
  data: Record<string, unknown>,
  opts?: { auth?: boolean; admin?: boolean },
): Promise<{ url: string }> {
  return getPriceListPdfUrlHandler(buildRequest(data, opts));
}

async function expectHttpsError(
  promise: Promise<unknown>,
  code: string,
): Promise<HttpsError> {
  try {
    await promise;
  } catch (err) {
    expect(err).to.be.instanceOf(HttpsError);
    expect((err as HttpsError).code).to.equal(code);
    return err as HttpsError;
  }
  throw new Error(`Expected HttpsError(${code}), but the call succeeded`);
}

async function listPdfObjects(listId: string): Promise<string[]> {
  const [files] = await getBucket().getFiles({
    prefix: `price-lists/${listId}/`,
  });
  return files.map((f) => f.name);
}

describe("getPriceListPdfUrl (Integration, real Storage)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
    await clearStorage();
  });

  it("writes the PDF to storage and returns a URL that serves it", async function () {
    this.timeout(15000);
    await seedCatalogItem("it-ahorn", {
      code: "3001",
      labelName: "Ahorn",
      labelMass: "24 mm",
    });
    await seedCatalogItem("it-platte", {
      code: "3156",
      labelName: "3-Schichtplatte, Fichte",
      labelMass: "19 mm",
      category: ["Holzplatten"],
      price: 34.8,
    });
    await seedPriceList("pl-holz", ["it-ahorn", "it-platte"]);

    const { url } = await callHandler({ priceListId: "pl-holz" });
    expect(url).to.be.a("string").and.not.be.empty;

    // Exactly one content-hashed object landed in the bucket.
    const objects = await listPdfObjects("pl-holz");
    expect(objects).to.have.length(1);
    expect(objects[0]).to.match(/^price-lists\/pl-holz\/[0-9a-f]{16}\.pdf$/);

    // The stored bytes are the designed PDF.
    const [stored] = await getBucket().file(objects[0]).download();
    expect(stored.subarray(0, 4).toString("utf8")).to.equal("%PDF");
    const { text } = await pdfParse(stored);
    expect(text).to.include("PREISLISTE");
    expect(text).to.include("Holz"); // title (two categories → workshop name)
    expect(text).to.include("Massivholz");
    expect(text).to.include("Holzplatten");
    expect(text).to.include("3001");
    expect(text).to.include("62.30");

    // The returned URL actually serves those bytes.
    const response = await fetch(url);
    expect(response.status).to.equal(200);
    const served = Buffer.from(await response.arrayBuffer());
    expect(served.equals(stored)).to.equal(true);
  });

  it("reuses the cached object for unchanged content, regenerates on change", async function () {
    this.timeout(15000);
    await seedCatalogItem("it-ahorn", { code: "3001", labelName: "Ahorn" });
    await seedPriceList("pl-cache", ["it-ahorn"]);

    await callHandler({ priceListId: "pl-cache" });
    await callHandler({ priceListId: "pl-cache" });
    expect(await listPdfObjects("pl-cache")).to.have.length(1);

    // A price change produces a different content hash → second object.
    const db = getFirestore();
    await db.doc("catalog/it-ahorn").update({
      variants: [
        {
          id: "base",
          label: null,
          pricingModel: "area",
          unitPrice: { default: 65 },
        },
      ],
    });
    await callHandler({ priceListId: "pl-cache" });
    expect(await listPdfObjects("pl-cache")).to.have.length(2);
  });

  it("rejects lists that mix workshops with failed-precondition", async () => {
    await seedCatalogItem("it-holz", { code: "3001", labelName: "Ahorn" });
    await seedCatalogItem("it-metall", {
      code: "2001",
      labelName: "Flachstahl",
      workshops: ["metall"],
      category: ["Flachstahl"],
    });
    await seedPriceList("pl-mixed", ["it-holz", "it-metall"]);

    const err = await expectHttpsError(
      callHandler({ priceListId: "pl-mixed" }),
      "failed-precondition",
    );
    expect(err.message).to.match(/holz.*metall|metall.*holz/);
    expect(await listPdfObjects("pl-mixed")).to.have.length(0);
  });

  it("rejects empty lists with failed-precondition", async () => {
    await seedPriceList("pl-empty", []);
    await expectHttpsError(
      callHandler({ priceListId: "pl-empty" }),
      "failed-precondition",
    );
  });

  it("requires auth and the admin claim", async () => {
    await seedCatalogItem("it-ahorn", { code: "3001", labelName: "Ahorn" });
    await seedPriceList("pl-auth", ["it-ahorn"]);

    await expectHttpsError(
      callHandler({ priceListId: "pl-auth" }, { auth: false }),
      "unauthenticated",
    );
    await expectHttpsError(
      callHandler({ priceListId: "pl-auth" }, { auth: true, admin: false }),
      "permission-denied",
    );
    await expectHttpsError(callHandler({}), "invalid-argument");
    await expectHttpsError(
      callHandler({ priceListId: "does-not-exist" }),
      "not-found",
    );
  });
});
