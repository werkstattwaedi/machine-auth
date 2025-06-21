import { expect } from "chai";
import { diversifyKey, testOnly } from "./key_diversification";

describe("Key Diversification", () => {
  /**
   * Test case based on NXP Application Note AN10922, Section 2.2.1.
   * This test validates the AES-128 key diversification process.
   */
  it("should correctly diversify a key according to the NXP example", () => {
    // Data from AN10922, Table 2
    const masterKey = "00112233445566778899AABBCCDDEEFF";
    const uidHex = "04782E21801D80";
    const systemIdentifierHex = "4E585020416275"; // ASCII for "NXP Auth"
    const applicationIDHex = "3042F5";
    const expectedDiversifiedKey = "a8dd63a3b89d54b37ca802473fda9175";

    // Monkey-patch the keyIdBytes to match the test case from the NXP document.
    const originalApplicationId = testOnly.keyIdBytes.application;
    testOnly.keyIdBytes.application = Buffer.from(applicationIDHex, "hex");

    const uidBytes = Buffer.from(uidHex, "hex");
    // The system identifier is passed as a string.
    const systemName = Buffer.from(systemIdentifierHex, "hex").toString(
      "ascii"
    );

    const diversifiedKey = diversifyKey(
      masterKey,
      systemName,
      uidBytes,
      "application"
    );

    // Restore the original value after the test.
    testOnly.keyIdBytes.application = originalApplicationId;

    expect(diversifiedKey).to.equal(expectedDiversifiedKey);
  });
});
