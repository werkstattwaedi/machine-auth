import { expect } from "chai";
import { handleKeyDiversification } from "../personalization/handle_key_diversification";
import { KeyDiversificationRequest } from "../proto/firebase_rpc/personalization.js";
import { diversifyKeys } from "../ntag/key_diversification";

describe("handleKeyDiversification", () => {
  const masterKey = "000102030405060708090a0b0c0d0e0f";
  const systemName = "OwwMachineAuth";
  const config = { masterKey, systemName };
  const uid = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);

  it("should generate correct diversified keys for a valid request", () => {
    const req: KeyDiversificationRequest = {
      tokenId: { value: uid },
    };
    const expected = diversifyKeys(
      masterKey,
      systemName,
      Buffer.from(uid).toString("hex")
    );
    const res = handleKeyDiversification(req, config);
    expect(Array.from(res.applicationKey?.value || [])).to.deep.equal(
      Array.from(Buffer.from(expected.application, "hex"))
    );
    expect(Array.from(res.authorizationKey?.value || [])).to.deep.equal(
      Array.from(Buffer.from(expected.authorization, "hex"))
    );
    expect(Array.from(res.reserved1Key?.value || [])).to.deep.equal(
      Array.from(Buffer.from(expected.reserved1, "hex"))
    );
    expect(Array.from(res.reserved2Key?.value || [])).to.deep.equal(
      Array.from(Buffer.from(expected.reserved2, "hex"))
    );
  });

  it("should throw for missing UID", () => {
    const req: KeyDiversificationRequest = {
      tokenId: undefined,
    };
    expect(() => handleKeyDiversification(req, config)).to.throw();
  });

  it("should throw for invalid UID length", () => {
    const req: KeyDiversificationRequest = {
      tokenId: { value: new Uint8Array([1, 2, 3]) },
    };
    expect(() => handleKeyDiversification(req, config)).to.throw();
  });
});
