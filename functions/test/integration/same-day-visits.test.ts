// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * getSameDayVisits (#854): the visits of the business day an open checkout
 * was opened on, for the kiosk's same-day waiver preview (CHK-39) — also for
 * a checkout left open since an earlier day, which a badge session can no
 * longer read through the rules.
 */

import { expect } from "chai";
import { Timestamp, type DocumentReference } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import {
  handleGetSameDayVisits,
  type GetSameDayVisitsRequest,
} from "../../src/invoice/same_day_visits";

const DAY_MS = 24 * 60 * 60 * 1000;
// A Monday a week ago, 10:00 in Zurich (well inside one business day).
const LAST_MONDAY = new Date(Date.now() - 7 * DAY_MS);
LAST_MONDAY.setUTCHours(9, 0, 0, 0);

function at(base: Date, plusHours: number): Timestamp {
  return Timestamp.fromMillis(base.getTime() + plusHours * 3600_000);
}

/** A plain kiosk badge session (no step-up) acting as `userId`. */
function badgeRequest(
  userId: string,
  data: GetSameDayVisitsRequest
): CallableRequest<GetSameDayVisitsRequest> {
  return {
    data,
    auth: {
      uid: `tag:${userId}:nonce`,
      token: { tagCheckout: true, actsAs: userId },
    },
  } as unknown as CallableRequest<GetSameDayVisitsRequest>;
}

async function seedCheckout(
  id: string,
  owner: DocumentReference,
  fields: Record<string, unknown>
) {
  await getFirestore()
    .collection("checkouts")
    .doc(id)
    .set({
      userId: owner,
      usageType: "regular",
      workshopsVisited: [],
      persons: [
        {
          name: "Alice Muster",
          userType: "erwachsen",
          userRef: owner,
          usageType: "regular",
        },
      ],
      ...fields,
    });
}

describe("getSameDayVisits (Integration)", () => {
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

  it("returns last Monday's closed visit for a checkout left open since then", async () => {
    const alice = getFirestore().doc("users/alice");
    await seedCheckout("co-paid", alice, {
      status: "closed",
      created: at(LAST_MONDAY, 0),
      closedAt: at(LAST_MONDAY, 2),
    });
    await seedCheckout("co-forgotten", alice, {
      status: "open",
      created: at(LAST_MONDAY, 3),
    });
    // Other days and cancelled visits are not part of the answer.
    await seedCheckout("co-other-day", alice, {
      status: "closed",
      created: at(LAST_MONDAY, 26),
      closedAt: at(LAST_MONDAY, 27),
    });
    await seedCheckout("co-cancelled", alice, {
      status: "cancelled",
      created: at(LAST_MONDAY, 1),
      closedAt: at(LAST_MONDAY, 1.5),
      cancelledAt: at(LAST_MONDAY, 5),
    });

    const { visits } = await handleGetSameDayVisits(
      badgeRequest("alice", { checkoutId: "co-forgotten" })
    );

    expect(visits.map((v) => v.id)).to.deep.equal(["co-paid"]);
    expect(visits[0].persons).to.deep.equal([
      {
        name: "Alice Muster",
        userType: "erwachsen",
        userRef: { id: "alice" },
        usageType: "regular",
      },
    ]);
    expect(visits[0].created).to.equal(at(LAST_MONDAY, 0).toMillis());
  });

  it("without a checkout id answers for today", async () => {
    const alice = getFirestore().doc("users/alice");
    await seedCheckout("co-today", alice, {
      status: "closed",
      created: Timestamp.now(),
      closedAt: Timestamp.now(),
    });
    await seedCheckout("co-paid", alice, {
      status: "closed",
      created: at(LAST_MONDAY, 0),
      closedAt: at(LAST_MONDAY, 2),
    });

    const { visits } = await handleGetSameDayVisits(badgeRequest("alice", {}));
    expect(visits.map((v) => v.id)).to.deep.equal(["co-today"]);
  });

  it("refuses someone else's checkout and a missing one alike", async () => {
    await seedCheckout("co-bob", getFirestore().doc("users/bob"), {
      status: "open",
      created: Timestamp.now(),
    });
    for (const checkoutId of ["co-bob", "co-missing"]) {
      try {
        await handleGetSameDayVisits(badgeRequest("alice", { checkoutId }));
        throw new Error("expected permission-denied");
      } catch (err) {
        expect((err as { code?: string }).code).to.equal("permission-denied");
      }
    }
  });

  it("answers a guest with nothing and refuses an unauthenticated call", async () => {
    const guest = await handleGetSameDayVisits({
      data: {},
      auth: { uid: "anon-1", token: { firebase: { sign_in_provider: "anonymous" } } },
    } as unknown as CallableRequest<GetSameDayVisitsRequest>);
    expect(guest.visits).to.deep.equal([]);

    try {
      await handleGetSameDayVisits({
        data: {},
      } as CallableRequest<GetSameDayVisitsRequest>);
      throw new Error("expected unauthenticated");
    } catch (err) {
      expect((err as { code?: string }).code).to.equal("unauthenticated");
    }
  });
});
