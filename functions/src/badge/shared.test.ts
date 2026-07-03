// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import type { UserEntity } from "../types/firestore_entities";
import { isBadgeEligibleFree, isBadgeItem } from "./shared";

function user(overrides: Partial<UserEntity>): UserEntity {
  return {
    firstName: "Test",
    lastName: "User",
    ...overrides,
  } as UserEntity;
}

describe("badge eligibility", () => {
  it("active members get the first badge free", () => {
    expect(
      isBadgeEligibleFree(
        user({ activeMembership: { id: "m1" } as never, permissions: [] })
      )
    ).to.equal(true);
  });

  it("any permission implies badge need — first badge free", () => {
    expect(
      isBadgeEligibleFree(
        user({ activeMembership: null, permissions: [{ id: "laser" } as never] })
      )
    ).to.equal(true);
  });

  it("no membership, no permissions — not eligible", () => {
    expect(
      isBadgeEligibleFree(user({ activeMembership: null, permissions: [] }))
    ).to.equal(false);
    expect(isBadgeEligibleFree(user({}))).to.equal(false);
  });
});

describe("isBadgeItem", () => {
  it("recognizes items by their server-written tokenId", () => {
    expect(isBadgeItem({ tokenId: "04c339aa1e1890" })).to.equal(true);
    expect(isBadgeItem({ tokenId: "" })).to.equal(false);
    expect(isBadgeItem({})).to.equal(false);
    expect(isBadgeItem({ tokenId: undefined })).to.equal(false);
  });
});
