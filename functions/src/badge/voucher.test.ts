// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { mintBadgeVoucher, verifyBadgeVoucher } from "./voucher";

const KEY = "fedcba9876543210fedcba9876543210";
const OTHER_KEY = "00112233445566778899aabbccddeeff";
const TOKEN_ID = "04c339aa1e1890";

describe("badge voucher", () => {
  it("round-trips tokenId and counter", () => {
    const voucher = mintBadgeVoucher(
      { tokenId: TOKEN_ID, sdmCounter: 42 },
      KEY
    );
    expect(verifyBadgeVoucher(voucher, KEY)).to.deep.equal({
      tokenId: TOKEN_ID,
      sdmCounter: 42,
    });
  });

  it("rejects a tampered tokenId (badge squatting)", () => {
    const voucher = mintBadgeVoucher({ tokenId: TOKEN_ID, sdmCounter: 1 }, KEY);
    const [, counter, expiry, mac] = voucher.split(".");
    const forged = `04aaaaaaaaaaaa.${counter}.${expiry}.${mac}`;
    expect(verifyBadgeVoucher(forged, KEY)).to.equal(null);
  });

  it("rejects a tampered counter", () => {
    const voucher = mintBadgeVoucher({ tokenId: TOKEN_ID, sdmCounter: 1 }, KEY);
    const [tokenId, , expiry, mac] = voucher.split(".");
    const forged = `${tokenId}.999.${expiry}.${mac}`;
    expect(verifyBadgeVoucher(forged, KEY)).to.equal(null);
  });

  it("rejects a stretched expiry", () => {
    const voucher = mintBadgeVoucher({ tokenId: TOKEN_ID, sdmCounter: 1 }, KEY);
    const [tokenId, counter, expiry, mac] = voucher.split(".");
    const forged = `${tokenId}.${counter}.${Number(expiry) + 60_000}.${mac}`;
    expect(verifyBadgeVoucher(forged, KEY)).to.equal(null);
  });

  it("rejects a voucher signed with a different key", () => {
    const voucher = mintBadgeVoucher(
      { tokenId: TOKEN_ID, sdmCounter: 1 },
      OTHER_KEY
    );
    expect(verifyBadgeVoucher(voucher, KEY)).to.equal(null);
  });

  it("rejects an expired voucher", () => {
    const minted = Date.now();
    const voucher = mintBadgeVoucher(
      { tokenId: TOKEN_ID, sdmCounter: 1 },
      KEY,
      minted
    );
    // Just before the 15-min TTL: valid. Just after: rejected.
    expect(
      verifyBadgeVoucher(voucher, KEY, minted + 14 * 60 * 1000)
    ).to.not.equal(null);
    expect(
      verifyBadgeVoucher(voucher, KEY, minted + 16 * 60 * 1000)
    ).to.equal(null);
  });

  it("rejects malformed input", () => {
    expect(verifyBadgeVoucher("", KEY)).to.equal(null);
    expect(verifyBadgeVoucher("a.b.c", KEY)).to.equal(null);
    expect(verifyBadgeVoucher("not-a-voucher", KEY)).to.equal(null);
  });
});
