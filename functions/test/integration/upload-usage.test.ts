// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview Regression coverage for `handleUploadUsage` (issue #159).
 *
 * Tier-2 launch-readiness item: the handler is the firmware-facing endpoint
 * for usage records. Without idempotency, retries (flaky LTE → response lost
 * after the writes succeeded) double-billed users by re-running the
 * `accumulateUsageIntoCheckout` math against duplicate `usage_machine` docs.
 *
 * The fix derives a deterministic doc ID `sha256(authId|machineId|checkIn)`
 * and uses `.create()` to atomically skip duplicates. The "idempotent retry"
 * test below would have caught the original bug.
 *
 * The Functions emulator is NOT started (config: firestore+auth only) so we
 * call the handler directly the same way `auth-handlers.test.ts` does.
 */

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  seedTestData,
  getFirestore,
} from "../emulator-helper";
import { handleUploadUsage } from "../../src/session/handle_upload_usage";
import type { UploadUsageRequest } from "../../src/proto/firebase_rpc/usage";

const TEST_MACHINE_ID = "machine-tablesaw";
const OTHER_MACHINE_ID = "machine-bandsaw";
const TEST_USER_ID = "user-alice";
const TEST_CATALOG_ID = "catalog-holz-machinehour";
const TEST_AUTH_ID = "auth-abc123";

const config = {
  masterKey: "000102030405060708090a0b0c0d0e0f",
  systemName: "OwwMachineAuth",
};

// One hour of usage in unix-seconds. We pick a fixed point in 2024 so that
// the assertion "startTime != Date.now()" is unambiguous.
const FIXED_CHECK_IN = 1_704_067_200; // 2024-01-01T00:00:00Z
const ONE_HOUR_SECONDS = 3600;

interface UsageRecordOpts {
  userId?: string;
  authenticationId?: string;
  machineId?: string;
  checkIn?: number;
  checkOut?: number;
}

function buildRequest(records: UsageRecordOpts[], machineId = TEST_MACHINE_ID): UploadUsageRequest {
  return {
    history: {
      machineId: { value: machineId },
      records: records.map((r) => ({
        userId: { value: r.userId ?? TEST_USER_ID },
        authenticationId: { value: r.authenticationId ?? TEST_AUTH_ID },
        checkIn: BigInt(r.checkIn ?? FIXED_CHECK_IN),
        checkOut: BigInt(r.checkOut ?? FIXED_CHECK_IN + ONE_HOUR_SECONDS),
        reason: undefined,
      })),
    },
  };
}

async function seedCatalog(
  catalogId: string,
  data: { name: string; unitPrice: { none: number; member?: number; intern?: number } },
): Promise<void> {
  const db = getFirestore();
  await db.collection("catalog").doc(catalogId).set({
    code: catalogId,
    name: data.name,
    workshops: ["holz"],
    pricingModel: "time",
    unitPrice: {
      none: data.unitPrice.none,
      member: data.unitPrice.member ?? data.unitPrice.none,
      intern: data.unitPrice.intern ?? data.unitPrice.none,
    },
    active: true,
    userCanAdd: false,
  });
}

async function seedBaseFixtures(opts: { extraMachineId?: string } = {}): Promise<void> {
  await seedCatalog(TEST_CATALOG_ID, {
    name: "Tischkreissäge",
    unitPrice: { none: 10 },
  });

  const machines: Record<string, unknown> = {
    [TEST_MACHINE_ID]: {
      name: "Tischkreissäge",
      workshop: "holz",
      checkoutTemplateId: `/catalog/${TEST_CATALOG_ID}`,
      requiredPermission: [],
      maco: `/maco/maco-${TEST_MACHINE_ID}`,
      control: {},
    },
  };
  if (opts.extraMachineId) {
    machines[opts.extraMachineId] = {
      name: "Bandsäge",
      workshop: "holz",
      checkoutTemplateId: `/catalog/${TEST_CATALOG_ID}`,
      requiredPermission: [],
      maco: `/maco/maco-${opts.extraMachineId}`,
      control: {},
    };
  }

  await seedTestData({
    users: {
      [TEST_USER_ID]: {
        firstName: "Alice",
        lastName: "Adult",
        email: "alice@example.com",
        permissions: [],
        roles: [],
        userType: "erwachsen",
      },
    },
    machines,
  });
}

async function getUsageMachineDocs(): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const db = getFirestore();
  const snap = await db.collection("usage_machine").get();
  return snap.docs;
}

async function getCheckoutItem(): Promise<admin.firestore.QueryDocumentSnapshot | null> {
  const db = getFirestore();
  const checkouts = await db.collection("checkouts").where("status", "==", "open").get();
  if (checkouts.empty) return null;
  const items = await checkouts.docs[0].ref.collection("items").get();
  return items.empty ? null : items.docs[0];
}

describe("handleUploadUsage (Integration)", () => {
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

  describe("schema validation", () => {
    it("throws when history is missing", async () => {
      try {
        await handleUploadUsage({ history: undefined }, config);
        expect.fail("Should have thrown");
      } catch (e) {
        expect((e as Error).message).to.equal("Missing usage history");
      }
    });

    it("throws when machineId is missing", async () => {
      try {
        await handleUploadUsage(
          {
            history: {
              machineId: undefined,
              records: [],
            },
          },
          config,
        );
        expect.fail("Should have thrown");
      } catch (e) {
        expect((e as Error).message).to.equal(
          "Missing machine ID in usage history",
        );
      }
    });

    it("skips records with missing userId or authenticationId", async () => {
      await seedBaseFixtures();
      const req: UploadUsageRequest = {
        history: {
          machineId: { value: TEST_MACHINE_ID },
          records: [
            // Missing userId
            {
              userId: undefined,
              authenticationId: { value: TEST_AUTH_ID },
              checkIn: BigInt(FIXED_CHECK_IN),
              checkOut: BigInt(FIXED_CHECK_IN + ONE_HOUR_SECONDS),
              reason: undefined,
            },
            // Missing authenticationId
            {
              userId: { value: TEST_USER_ID },
              authenticationId: undefined,
              checkIn: BigInt(FIXED_CHECK_IN),
              checkOut: BigInt(FIXED_CHECK_IN + ONE_HOUR_SECONDS),
              reason: undefined,
            },
          ],
        },
      };

      const res = await handleUploadUsage(req, config);
      expect(res.success).to.be.true;
      const docs = await getUsageMachineDocs();
      expect(docs).to.have.length(0);
    });

    it("skips records with checkOut == 0 (open session)", async () => {
      await seedBaseFixtures();
      const req = buildRequest([{ checkOut: 0 }]);
      const res = await handleUploadUsage(req, config);
      expect(res.success).to.be.true;
      const docs = await getUsageMachineDocs();
      expect(docs).to.have.length(0);
    });
  });

  describe("happy path", () => {
    it("creates exactly one usage_machine doc with deterministic ID and event-time", async () => {
      await seedBaseFixtures();

      const beforeMs = Date.now();
      const res = await handleUploadUsage(buildRequest([{}]), config);
      expect(res.success).to.be.true;

      const docs = await getUsageMachineDocs();
      expect(docs).to.have.length(1);

      // Deterministic ID is hex (sha256 truncated to 20 chars)
      expect(docs[0].id).to.match(/^[0-9a-f]{20}$/);

      // Event time comes from firmware-supplied checkIn, NOT Date.now().
      const data = docs[0].data();
      const startTime = (data.startTime as Timestamp).toMillis();
      const endTime = (data.endTime as Timestamp).toMillis();
      expect(startTime).to.equal(FIXED_CHECK_IN * 1000);
      expect(endTime).to.equal((FIXED_CHECK_IN + ONE_HOUR_SECONDS) * 1000);
      // Sanity: assert the event time is far in the past, NOT close to now.
      expect(Math.abs(startTime - beforeMs)).to.be.greaterThan(
        365 * 24 * 60 * 60 * 1000, // > 1 year apart
      );

      // Checkout item created with right quantity/totalPrice.
      const item = await getCheckoutItem();
      expect(item, "expected open checkout item").to.not.be.null;
      const itemData = item!.data();
      expect(itemData.quantity).to.equal(1); // 1 hour
      expect(itemData.unitPrice).to.equal(10);
      expect(itemData.totalPrice).to.equal(10);
      expect(itemData.origin).to.equal("nfc");
    });
  });

  describe("idempotency", () => {
    it("idempotent retry: same payload twice → exactly one doc, quantity unchanged", async () => {
      await seedBaseFixtures();

      const req = buildRequest([{}]);

      // First upload — creates the record + checkout item.
      const r1 = await handleUploadUsage(req, config);
      expect(r1.success).to.be.true;
      const after1 = await getUsageMachineDocs();
      expect(after1).to.have.length(1);
      const item1 = await getCheckoutItem();
      expect(item1!.data().quantity).to.equal(1);
      expect(item1!.data().totalPrice).to.equal(10);

      // Second upload — same payload. Doc count and quantity must NOT double.
      const r2 = await handleUploadUsage(req, config);
      expect(r2.success).to.be.true;
      const after2 = await getUsageMachineDocs();
      expect(after2).to.have.length(1, "retry must not create a duplicate doc");

      const item2 = await getCheckoutItem();
      expect(item2!.data().quantity).to.equal(
        1,
        "retry must not double-count quantity",
      );
      expect(item2!.data().totalPrice).to.equal(
        10,
        "retry must not double-count totalPrice",
      );
    });

    it("concurrent retry: Promise.all of same payload → exactly one doc, no doubling", async () => {
      await seedBaseFixtures();

      const req = buildRequest([{}]);

      // Two simultaneous calls with the same payload. The deterministic ID +
      // .create() catch path means both should resolve successfully and there
      // must be exactly one doc.
      const [r1, r2] = await Promise.all([
        handleUploadUsage(req, config),
        handleUploadUsage(req, config),
      ]);
      expect(r1.success).to.be.true;
      expect(r2.success).to.be.true;

      const docs = await getUsageMachineDocs();
      expect(docs).to.have.length(1, "concurrent retry must not create duplicates");

      const item = await getCheckoutItem();
      expect(item!.data().quantity).to.equal(1);
      expect(item!.data().totalPrice).to.equal(10);
    });

    it("mixed batch: [A,B] then [B,C] → docs A,B,C exactly once, quantity = sum", async () => {
      await seedBaseFixtures();

      const A = { authenticationId: "auth-A", checkIn: FIXED_CHECK_IN };
      const B = {
        authenticationId: "auth-B",
        checkIn: FIXED_CHECK_IN + 2 * ONE_HOUR_SECONDS,
      };
      const C = {
        authenticationId: "auth-C",
        checkIn: FIXED_CHECK_IN + 4 * ONE_HOUR_SECONDS,
      };

      // Each record is 1 hour.
      const recordize = (r: { authenticationId: string; checkIn: number }) => ({
        authenticationId: r.authenticationId,
        checkIn: r.checkIn,
        checkOut: r.checkIn + ONE_HOUR_SECONDS,
      });

      // First batch: A + B
      await handleUploadUsage(
        buildRequest([recordize(A), recordize(B)]),
        config,
      );
      let docs = await getUsageMachineDocs();
      expect(docs).to.have.length(2);
      let item = await getCheckoutItem();
      expect(item!.data().quantity).to.equal(2);

      // Second batch: B (overlap) + C — B must be skipped, C inserted.
      await handleUploadUsage(
        buildRequest([recordize(B), recordize(C)]),
        config,
      );
      docs = await getUsageMachineDocs();
      expect(docs).to.have.length(3, "B must not be re-inserted");
      item = await getCheckoutItem();
      expect(item!.data().quantity).to.equal(3, "quantity must equal A+B+C, not A+2B+C");
      expect(item!.data().totalPrice).to.equal(30);
    });
  });

  describe("doc-ID determinism", () => {
    it("same authId on different machines → two distinct docs", async () => {
      await seedBaseFixtures({ extraMachineId: OTHER_MACHINE_ID });

      // First machine
      await handleUploadUsage(
        buildRequest([{ authenticationId: "auth-shared" }], TEST_MACHINE_ID),
        config,
      );
      // Second machine, SAME authId + same checkIn
      await handleUploadUsage(
        buildRequest([{ authenticationId: "auth-shared" }], OTHER_MACHINE_ID),
        config,
      );

      const docs = await getUsageMachineDocs();
      expect(docs).to.have.length(
        2,
        "machineId must be in the hash so same authId on different machines yields distinct docs",
      );
      expect(new Set(docs.map((d) => d.id)).size).to.equal(2);
    });
  });
});
