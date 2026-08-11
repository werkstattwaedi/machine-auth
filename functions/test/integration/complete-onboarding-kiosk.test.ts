// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Covers completeOnboardingKiosk (issue #595): the sanctioned write path for
// the kiosk welcome onboarding. The established actsAs session is the
// credential; the write targets exactly the claimed user. Firestore rules
// keep rejecting direct users-doc writes from synthetic principals — this
// callable is the only door, so its auth gate is the load-bearing check.

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import {
  completeOnboardingKioskHandler,
  type CompleteOnboardingKioskInput,
} from "../../src/checkout/complete_onboarding_kiosk";

/** A synthetic kiosk-session request acting on `userId`. */
function kioskRequest(
  userId: string,
  data: CompleteOnboardingKioskInput
): CallableRequest<CompleteOnboardingKioskInput> {
  return {
    data,
    auth: {
      uid: `tag:${userId}:nonce`,
      token: { tagCheckout: true, actsAs: userId },
    },
  } as unknown as CallableRequest<CompleteOnboardingKioskInput>;
}

async function expectHttpsError(
  fn: () => Promise<unknown>,
  expectedCode: string
): Promise<void> {
  try {
    await fn();
    throw new Error(`expected HttpsError code=${expectedCode}, got success`);
  } catch (err: any) {
    expect(err?.code).to.equal(expectedCode);
  }
}

const PROFILE = {
  firstName: "Franziska",
  lastName: "Imported",
  phone: "+41791234567",
  billingAddress: {
    company: "",
    street: "Johanniterstrasse 3",
    zip: "8820",
    city: "Wädenswil",
  },
};

describe("completeOnboardingKiosk (Integration)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
    await getFirestore().collection("users").doc("member1").set({
      email: "imported@example.com",
      firstName: "Fanziska", // typo the wizard's data check corrects
      lastName: "Imported",
      userType: "erwachsen",
      roles: [],
      permissions: ["perm-1"],
      termsAcceptedAt: null,
      created: Timestamp.now(),
    });
  });

  it("rejects an unauthenticated call", async () => {
    await expectHttpsError(
      () =>
        completeOnboardingKioskHandler({
          data: { termsAccepted: true },
        } as CallableRequest<CompleteOnboardingKioskInput>),
      "unauthenticated"
    );
  });

  it("rejects a real (non-kiosk) session — no actsAs claim", async () => {
    await expectHttpsError(
      () =>
        completeOnboardingKioskHandler({
          data: { termsAccepted: true },
          auth: { uid: "member1", token: {} },
        } as unknown as CallableRequest<CompleteOnboardingKioskInput>),
      "permission-denied"
    );
  });

  it("applies step-2 profile edits without touching roles/permissions/terms", async () => {
    const result = await completeOnboardingKioskHandler(
      kioskRequest("member1", { profile: PROFILE })
    );
    expect(result).to.deep.equal({ ok: true });

    const doc = await getFirestore().collection("users").doc("member1").get();
    expect(doc.get("firstName")).to.equal("Franziska");
    expect(doc.get("phone")).to.equal("+41791234567");
    expect(doc.get("billingAddress")).to.deep.equal(PROFILE.billingAddress);
    expect(doc.get("termsAcceptedAt")).to.be.null;
    expect(doc.get("permissions")).to.deep.equal(["perm-1"]);
    expect(doc.get("userType")).to.equal("erwachsen");
  });

  it("records the step-3 terms acceptance", async () => {
    await completeOnboardingKioskHandler(
      kioskRequest("member1", { termsAccepted: true })
    );
    const doc = await getFirestore().collection("users").doc("member1").get();
    expect(doc.get("termsAcceptedAt")).to.not.be.null;
    // Profile untouched by a terms-only call.
    expect(doc.get("firstName")).to.equal("Fanziska");
  });

  it("validates the profile (names, phone shape, firma address)", async () => {
    await expectHttpsError(
      () =>
        completeOnboardingKioskHandler(
          kioskRequest("member1", {
            profile: { ...PROFILE, firstName: "  " },
          })
        ),
      "invalid-argument"
    );
    await expectHttpsError(
      () =>
        completeOnboardingKioskHandler(
          kioskRequest("member1", {
            profile: { ...PROFILE, phone: "not-a-number" },
          })
        ),
      "invalid-argument"
    );

    // A firma doc requires company + full address.
    await getFirestore()
      .collection("users")
      .doc("member1")
      .update({ userType: "firma" });
    await expectHttpsError(
      () =>
        completeOnboardingKioskHandler(
          kioskRequest("member1", { profile: PROFILE }) // company empty
        ),
      "invalid-argument"
    );
  });

  it("terms are write-once; profile edits close once terms are accepted", async () => {
    await completeOnboardingKioskHandler(
      kioskRequest("member1", { termsAccepted: true })
    );
    const stamped = (
      await getFirestore().collection("users").doc("member1").get()
    ).get("termsAcceptedAt");
    expect(stamped).to.not.be.null;

    // Re-accepting (wizard step back/forward) is an idempotent success that
    // keeps the ORIGINAL consent timestamp.
    const again = await completeOnboardingKioskHandler(
      kioskRequest("member1", { termsAccepted: true })
    );
    expect(again).to.deep.equal({ ok: true });
    const restamped = (
      await getFirestore().collection("users").doc("member1").get()
    ).get("termsAcceptedAt");
    expect(restamped.isEqual(stamped)).to.equal(true);

    // A routine kiosk session of an onboarded member cannot rewrite the
    // profile through this door.
    await expectHttpsError(
      () =>
        completeOnboardingKioskHandler(
          kioskRequest("member1", { profile: PROFILE })
        ),
      "failed-precondition"
    );
    const doc = await getFirestore().collection("users").doc("member1").get();
    expect(doc.get("firstName")).to.equal("Fanziska");
  });

  it("rejects an empty update and a missing user doc", async () => {
    await expectHttpsError(
      () => completeOnboardingKioskHandler(kioskRequest("member1", {})),
      "invalid-argument"
    );
    await expectHttpsError(
      () =>
        completeOnboardingKioskHandler(
          kioskRequest("ghost", { termsAccepted: true })
        ),
      "failed-precondition"
    );
  });
});
