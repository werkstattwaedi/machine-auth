# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Verify Python key diversification matches TS implementation."""

import unittest
from ntag_key_diversification import diversify_key, KEY_IDS


class KeyDiversificationTest(unittest.TestCase):
    def test_nxp_an10922_vector(self):
        """NXP AN10922 Section 2.2.1 test vector (same as TS test)."""
        # Monkey-patch application key ID to match NXP example
        original = KEY_IDS["application"]
        KEY_IDS["application"] = bytes.fromhex("3042F5")
        try:
            master_key = bytes.fromhex("00112233445566778899AABBCCDDEEFF")
            uid = bytes.fromhex("04782E21801D80")
            # "NXP Abu" in ASCII = 4E585020416275
            system_name = bytes.fromhex("4E585020416275").decode("ascii")

            result = diversify_key(master_key, system_name, uid, "application")
            expected = bytes.fromhex("a8dd63a3b89d54b37ca802473fda9175")
            self.assertEqual(result, expected)
        finally:
            KEY_IDS["application"] = original


if __name__ == "__main__":
    unittest.main()
