import { expect } from "chai";
import { handleKeyDiversification } from "../personalization/handle_key_diversification";
import { KeyDiversificationRequestT } from "../fbs/key-diversification-request";
import { TagUidT } from "../fbs";
import { diversifyKeys } from "../ntag/key_diversification";

describe("handleKeyDiversification", () => {
  const masterKey = "000102030405060708090a0b0c0d0e0f";
  const systemName = "OwwMachineAuth";
  const config = { masterKey, systemName };
  const uid = [1, 2, 3, 4, 5, 6, 7];

  it("should generate correct diversified keys for a valid request", () => {
    const req = new KeyDiversificationRequestT(new TagUidT(uid));
    const expected = diversifyKeys(
      masterKey,
      systemName,
      Buffer.from(uid).toString("hex")
    );
    const res = handleKeyDiversification(req, config);
    expect(res.applicationKey?.uid).to.deep.equal(
      Array.from(Buffer.from(expected.application, "hex"))
    );
    expect(res.authorizationKey?.uid).to.deep.equal(
      Array.from(Buffer.from(expected.authorization, "hex"))
    );
    expect(res.reserved1Key?.uid).to.deep.equal(
      Array.from(Buffer.from(expected.reserved1, "hex"))
    );
    expect(res.reserved2Key?.uid).to.deep.equal(
      Array.from(Buffer.from(expected.reserved2, "hex"))
    );
  });

  it("should throw for missing UID", () => {
    const req = new KeyDiversificationRequestT(null);
    expect(() => handleKeyDiversification(req, config)).to.throw();
  });

  it("should throw for invalid UID length", () => {
    const req = new KeyDiversificationRequestT(new TagUidT([1, 2, 3]));
    expect(() => handleKeyDiversification(req, config)).to.throw();
  });
});
