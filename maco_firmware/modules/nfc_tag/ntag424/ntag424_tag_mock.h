// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>

#include "maco_firmware/modules/nfc_tag/mock_tag.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_secure_messaging.h"
#include "pw_bytes/span.h"
#include "pw_random/random.h"
#include "pw_result/result.h"

namespace maco::nfc {

/// Mock NTAG424 DNA tag with full authentication state machine.
///
/// Implements the tag side of the NTAG424 mutual authentication protocol,
/// including:
/// - Application selection (ISO SelectFile)
/// - AuthenticateEV2First (3-pass AES-128 mutual auth)
/// - GetCardUid (encrypted UID retrieval)
///
/// State machine:
///   IDLE → (SelectApp) → SELECTED → (AuthPart1) → AUTH_PART1_SENT
///        → (AuthPart2) → AUTHENTICATED
///   SelectApp from any state resets to SELECTED.
///   Auth failure reverts to SELECTED.
class Ntag424TagMock : public MockTag {
 public:
  struct Config {
    std::array<std::byte, 7> real_uid;
    std::array<std::array<std::byte, 16>, 5> keys;  // Slots 0-4
  };

  Ntag424TagMock(pw::ConstByteSpan uid,
                  uint8_t sak,
                  const Config& config,
                  pw::random::RandomGenerator& rng);

  pw::Result<size_t> HandleTransceive(
      pw::ConstByteSpan command, pw::ByteSpan response_buffer) override;

  bool authenticated() const { return state_ == State::kAuthenticated; }
  uint8_t authenticated_key_number() const { return auth_key_number_; }

 protected:
  void OnEnterField() override;
  void OnLeaveField() override;

 private:
  enum class State {
    kIdle,
    kSelected,
    kAuthPart1Sent,
    kAuthenticated,
  };

  // APDU handlers
  pw::Result<size_t> HandleSelectApp(pw::ConstByteSpan command,
                                      pw::ByteSpan response);
  pw::Result<size_t> HandleAuthPart1(pw::ConstByteSpan command,
                                      pw::ByteSpan response);
  pw::Result<size_t> HandleAuthPart2(pw::ConstByteSpan command,
                                      pw::ByteSpan response);
  pw::Result<size_t> HandleGetCardUid(pw::ConstByteSpan command,
                                       pw::ByteSpan response);

  // Helpers
  size_t WriteStatus(pw::ByteSpan buf, uint8_t sw1, uint8_t sw2);

  Config config_;
  pw::random::RandomGenerator& rng_;
  State state_ = State::kIdle;

  // Auth context (valid during authentication handshake)
  uint8_t auth_key_number_ = 0;
  std::array<std::byte, 16> auth_rnd_b_{};

  // Session state (valid after authentication)
  std::optional<SecureMessaging> secure_messaging_;
  std::array<std::byte, 16> ses_auth_enc_key_{};  // For direct encryption
};

}  // namespace maco::nfc
