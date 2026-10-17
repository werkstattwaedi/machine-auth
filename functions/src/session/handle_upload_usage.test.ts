// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Machine time switches the owner to regular use (CHK-40, ADR-0050).
 */

import { expect } from "chai";
import { DocumentReference } from "firebase-admin/firestore";
import { ownerSwitchForMachineTime } from "./handle_upload_usage";
import type { CheckoutPersonEntity } from "../types/firestore_entities";

function ref(id: string): DocumentReference {
  return { id } as unknown as DocumentReference;
}

const owner = (usageType?: CheckoutPersonEntity["usageType"]): CheckoutPersonEntity => ({
  name: "Olivia Owner",
  email: "olivia@example.com",
  userType: "erwachsen",
  userRef: ref("owner"),
  ...(usageType ? { usageType } : {}),
});

const guest = (usageType?: CheckoutPersonEntity["usageType"]): CheckoutPersonEntity => ({
  name: "Gina Guest",
  email: "",
  userType: "erwachsen",
  ...(usageType ? { usageType } : {}),
});

describe("ownerSwitchForMachineTime (CHK-40)", () => {
  it("moves an owner on Begleitung to regular; the visit type follows", () => {
    const update = ownerSwitchForMachineTime({
      userId: ref("owner"),
      usageType: "materialbezug",
      persons: [owner("materialbezug")],
    });
    expect(update).to.not.equal(null);
    expect(update!.persons[0].usageType).to.equal("regular");
    expect(update!.persons[0].userRef?.id).to.equal("owner");
    expect(update!.usageType).to.equal("regular");
  });

  it("leaves the other persons on their own types", () => {
    const update = ownerSwitchForMachineTime({
      userId: ref("owner"),
      usageType: "materialbezug",
      persons: [owner("materialbezug"), guest("materialbezug")],
    });
    expect(update!.persons.map((p) => p.usageType)).to.deep.equal([
      "regular",
      "materialbezug",
    ]);
    expect(update!.usageType).to.equal("regular");
  });

  it("pins pre-#605 persons to the type they read as before", () => {
    const update = ownerSwitchForMachineTime({
      userId: ref("owner"),
      usageType: "materialbezug",
      persons: [owner(), guest()],
    });
    expect(update!.persons.map((p) => p.usageType)).to.deep.equal([
      "regular",
      "materialbezug",
    ]);
  });

  for (const type of ["regular", "volunteering", "intern", "ermaessigt"] as const) {
    it(`leaves an owner on ${type} untouched`, () => {
      expect(
        ownerSwitchForMachineTime({
          userId: ref("owner"),
          usageType: type,
          persons: [owner(type)],
        }),
      ).to.equal(null);
    });
  }

  it("does nothing without an owner line (new checkout, guest-only roster)", () => {
    expect(
      ownerSwitchForMachineTime({ userId: ref("owner"), usageType: "regular", persons: [] }),
    ).to.equal(null);
    expect(
      ownerSwitchForMachineTime({
        userId: ref("owner"),
        usageType: "materialbezug",
        persons: [guest("materialbezug")],
      }),
    ).to.equal(null);
  });

  it("ignores another member's line", () => {
    expect(
      ownerSwitchForMachineTime({
        userId: ref("owner"),
        usageType: "materialbezug",
        persons: [{ ...owner("materialbezug"), userRef: ref("someone-else") }],
      }),
    ).to.equal(null);
  });
});
