/**
 * @fileoverview Test helper for generating valid NTAG424 SDM test data.
 *
 * The implementation lives in `src/ntag/sdm_mint.ts` (it is also what the
 * staging-only `mintTestTap` function runs); this re-export keeps the name
 * the integration tests import.
 *
 * COPY NOTE: A self-contained copy lives in web/apps/checkout/e2e/
 * sdm-test-helper.ts for Playwright E2E tests. If the crypto changes,
 * update both.
 */

export { mintSdmTap as generateValidPICCAndCMAC } from "../src/ntag/sdm_mint";
