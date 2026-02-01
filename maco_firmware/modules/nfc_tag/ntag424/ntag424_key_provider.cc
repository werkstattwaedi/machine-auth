// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_key_provider.h"

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_crypto.h"

namespace maco::nfc {

SessionKeys::~SessionKeys() {
  // Securely zero session keys to minimize their lifetime in memory
  SecureZero(ses_auth_enc_key);
  SecureZero(ses_auth_mac_key);
}

}  // namespace maco::nfc
