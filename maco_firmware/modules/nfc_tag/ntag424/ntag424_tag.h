// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>

#include "maco_firmware/modules/nfc_tag/iso14443_tag.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_crypto.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_key_provider.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_session.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_random/random.h"
#include "pw_result/result.h"
#include "pw_status/status.h"
#include "pw_status/try.h"

namespace maco::nfc {

// Forward declaration
class Ntag424KeyProvider;

/// NTAG424 DNA APDU command constants.
namespace ntag424_cmd {
constexpr uint8_t kClaNative = 0x90;  // Native command CLA
constexpr uint8_t kClaIso = 0x00;     // ISO 7816-4 CLA

// Native commands
constexpr uint8_t kAuthenticateEv2First = 0x71;
constexpr uint8_t kAuthenticateEv2NonFirst = 0x77;
constexpr uint8_t kGetCardUid = 0x51;
constexpr uint8_t kGetFileSettings = 0xF5;
constexpr uint8_t kChangeFileSettings = 0x5F;
constexpr uint8_t kReadData = 0xAD;
constexpr uint8_t kWriteData = 0x8D;
constexpr uint8_t kChangeKey = 0xC4;
constexpr uint8_t kGetVersion = 0x60;
constexpr uint8_t kAdditionalFrame = 0xAF;

// ISO commands
constexpr uint8_t kIsoSelectFile = 0xA4;
}  // namespace ntag424_cmd

/// Base class for NTAG424 DNA tag operations.
///
/// Uses CRTP indirectly - inherits from Iso14443Tag which is templated.
/// This base class provides non-template functionality.
class Ntag424TagBase {
 public:
  /// Session state (keys, command counter, transaction ID).
  /// Stored in tag, not in session token.
  struct SessionState {
    std::array<std::byte, 16> ses_auth_enc_key;
    std::array<std::byte, 16> ses_auth_mac_key;
    std::array<std::byte, 4> transaction_identifier;
    uint16_t command_counter = 0;
  };

  virtual ~Ntag424TagBase() = default;

  /// Check if currently authenticated.
  bool is_authenticated() const { return session_state_.has_value(); }

  /// Get the current session state (if authenticated).
  const SessionState* session_state() const {
    return session_state_ ? &*session_state_ : nullptr;
  }

 protected:
  /// Called when tag is invalidated. Clears session state.
  void ClearSession() {
    if (current_session_) {
      current_session_->Invalidate();
      current_session_ = nullptr;
    }
    session_state_.reset();
  }

  /// Set session state after successful authentication.
  void SetSessionState(const SessionState& state, Ntag424Session* session) {
    session_state_ = state;
    current_session_ = session;
  }

  /// Increment command counter. Returns false on overflow.
  bool IncrementCommandCounter() {
    if (!session_state_) return false;
    if (session_state_->command_counter == 0xFFFF) {
      return false;  // Overflow - session exhausted
    }
    session_state_->command_counter++;
    return true;
  }

  std::optional<SessionState> session_state_;
  Ntag424Session* current_session_ = nullptr;
};

/// NTAG424 DNA tag.
///
/// Provides authenticated and unauthenticated operations for NTAG424 DNA tags.
/// Session state is stored in the tag; Ntag424Session is just a capability
/// token.
///
/// @tparam Driver NFC driver type
template <typename Driver>
class Ntag424Tag : public Iso14443Tag<Driver>, public Ntag424TagBase {
 public:
  using Iso14443Tag<Driver>::Iso14443Tag;

  /// Default command timeout.
  static constexpr auto kDefaultTimeout = std::chrono::milliseconds(500);

  // --- Unauthenticated operations ---

  /// Select the NTAG424 DNA application.
  /// Must be called before authentication.
  pw::Status SelectApplication() {
    // ISOSelectFile: CLA=0x00, INS=0xA4, P1=0x04, P2=0x0C
    // Data: DF name = D2 76 00 00 85 01 01
    constexpr std::array<std::byte, 13> select_cmd = {
        std::byte{ntag424_cmd::kClaIso},
        std::byte{ntag424_cmd::kIsoSelectFile},
        std::byte{0x04},  // P1: Select by DF name
        std::byte{0x0C},  // P2: No response data
        std::byte{0x07},  // Lc: 7 bytes
        std::byte{0xD2}, std::byte{0x76}, std::byte{0x00}, std::byte{0x00},
        std::byte{0x85}, std::byte{0x01}, std::byte{0x01},
        std::byte{0x00}   // Le
    };

    std::array<std::byte, 2> response;
    auto result = this->Transceive(select_cmd, response, kDefaultTimeout);
    if (!result.ok()) {
      return result.status();
    }

    // Check status word (SW1=0x90, SW2=0x00 for success)
    if (result.value() >= 2) {
      uint8_t sw1 = static_cast<uint8_t>(response[result.value() - 2]);
      uint8_t sw2 = static_cast<uint8_t>(response[result.value() - 1]);
      if (sw1 != 0x90 || sw2 != 0x00) {
        return pw::Status::Internal();
      }
    }

    return pw::OkStatus();
  }

  /// Get tag version information.
  /// @param version_buffer Buffer for version data (28 bytes)
  pw::Result<size_t> GetVersion(pw::ByteSpan version_buffer) {
    // GetVersion: CLA=0x90, INS=0x60
    constexpr std::array<std::byte, 5> cmd = {
        std::byte{ntag424_cmd::kClaNative},
        std::byte{ntag424_cmd::kGetVersion},
        std::byte{0x00},  // P1
        std::byte{0x00},  // P2
        std::byte{0x00}   // Le
    };

    return TransceiveNative(cmd, version_buffer);
  }

  // --- Authentication ---

  /// Authenticate with a key provider.
  /// Implements AuthenticateEV2First (3-pass mutual authentication).
  /// @param key_provider Provides key number and crypto operations
  /// @param random_generator Random number generator for RndA
  /// @return Session token on success
  pw::Result<Ntag424Session> Authenticate(
      Ntag424KeyProvider& key_provider,
      pw::random::RandomGenerator& random_generator) {
    // Clear any existing session
    ClearSession();

    // --- Part 1: Send AuthenticateEV2First command ---
    // Command: 90 71 00 00 02 [KeyNo] [LenCap=0x00] 00
    std::array<std::byte, 8> part1_cmd = {
        std::byte{ntag424_cmd::kClaNative},
        std::byte{ntag424_cmd::kAuthenticateEv2First},
        std::byte{0x00},                               // P1
        std::byte{0x00},                               // P2
        std::byte{0x02},                               // Lc: 2 bytes
        std::byte{key_provider.key_number()},          // KeyNo
        std::byte{0x00},                               // LenCap (no PCDcap2)
        std::byte{0x00}                                // Le
    };

    std::array<std::byte, 20> part1_response;  // 16 bytes + 2 SW + margin
    auto part1_result = this->Transceive(
        part1_cmd, part1_response, kDefaultTimeout);
    if (!part1_result.ok()) {
      return part1_result.status();
    }

    // Check response: should be 18 bytes (16 encrypted RndB + SW 91 AF)
    size_t part1_len = part1_result.value();
    if (part1_len < 18) {
      return pw::Status::DataLoss();
    }
    uint8_t sw1 = static_cast<uint8_t>(part1_response[part1_len - 2]);
    uint8_t sw2 = static_cast<uint8_t>(part1_response[part1_len - 1]);
    if (sw1 != 0x91 || sw2 != 0xAF) {
      return InterpretStatusWord(sw1, sw2);
    }

    // Extract encrypted RndB (first 16 bytes)
    pw::ConstByteSpan encrypted_rnd_b(part1_response.data(), 16);

    // --- Generate RndA using CSPRNG ---
    std::array<std::byte, 16> rnd_a;
    random_generator.Get(rnd_a);

    // --- Compute authentication response via key provider ---
    auto compute_result = key_provider.ComputeAuthResponse(rnd_a, encrypted_rnd_b);
    if (!compute_result.ok()) {
      return compute_result.status();
    }
    const AuthComputeResult& auth_result = compute_result.value();

    // --- Part 2: Send additional frame with encrypted RndA||RndB' ---
    // Command: 90 AF 00 00 20 [32 bytes encrypted data] 00
    std::array<std::byte, 38> part2_cmd;
    part2_cmd[0] = std::byte{ntag424_cmd::kClaNative};
    part2_cmd[1] = std::byte{ntag424_cmd::kAdditionalFrame};
    part2_cmd[2] = std::byte{0x00};  // P1
    part2_cmd[3] = std::byte{0x00};  // P2
    part2_cmd[4] = std::byte{0x20};  // Lc: 32 bytes
    std::copy(auth_result.part2_response.begin(),
              auth_result.part2_response.end(),
              part2_cmd.begin() + 5);
    part2_cmd[37] = std::byte{0x00};  // Le

    std::array<std::byte, 36> part2_response;  // 32 bytes + 2 SW + margin
    auto part2_result = this->Transceive(
        part2_cmd, part2_response, kDefaultTimeout);
    if (!part2_result.ok()) {
      return part2_result.status();
    }

    // Check response: should be 34 bytes (32 encrypted + SW 91 00)
    size_t part2_len = part2_result.value();
    if (part2_len < 34) {
      return pw::Status::DataLoss();
    }
    sw1 = static_cast<uint8_t>(part2_response[part2_len - 2]);
    sw2 = static_cast<uint8_t>(part2_response[part2_len - 1]);
    if (sw1 != 0x91 || sw2 != 0x00) {
      return InterpretStatusWord(sw1, sw2);
    }

    // Decrypt the response to get TI || RndA' || PDcap2 || PCDcap2
    pw::ConstByteSpan encrypted_part2(part2_response.data(), 32);
    std::array<std::byte, 32> decrypted_part2;
    constexpr std::array<std::byte, 16> zero_iv = {};
    PW_TRY(AesCbcDecrypt(
        auth_result.ses_auth_enc_key, zero_iv, encrypted_part2, decrypted_part2));

    // Extract TI (first 4 bytes)
    std::array<std::byte, 4> ti;
    std::copy(decrypted_part2.begin(), decrypted_part2.begin() + 4, ti.begin());

    // Verify RndA' (bytes 4-19) matches RndA rotated left
    pw::ConstByteSpan rnd_a_prime(decrypted_part2.data() + 4, 16);
    if (!VerifyRndAPrime(rnd_a, rnd_a_prime)) {
      // Mutual authentication failed - tag did not prove knowledge of key
      return pw::Status::Unauthenticated();
    }

    // Authentication successful - store session state
    SessionState state;
    state.ses_auth_enc_key = auth_result.ses_auth_enc_key;
    state.ses_auth_mac_key = auth_result.ses_auth_mac_key;
    state.transaction_identifier = ti;
    state.command_counter = 0;

    // Store state in tag (session validity is checked via is_authenticated())
    SetSessionState(state, nullptr);

    // Return session token (caller should use is_authenticated() for validity)
    return Ntag424Session(key_provider.key_number());
  }

  // --- Authenticated operations ---

  /// Get the true 7-byte card UID (requires authentication).
  /// @param session Session token proving authentication
  /// @param uid_buffer Buffer for UID (7 bytes)
  pw::Result<size_t> GetCardUid(const Ntag424Session& session,
                                pw::ByteSpan uid_buffer) {
    if (!session.is_valid() || !is_authenticated()) {
      return pw::Status::Unauthenticated();
    }

    // GetCardUID: CLA=0x90, INS=0x51
    constexpr std::array<std::byte, 5> cmd = {
        std::byte{ntag424_cmd::kClaNative},
        std::byte{ntag424_cmd::kGetCardUid},
        std::byte{0x00},  // P1
        std::byte{0x00},  // P2
        std::byte{0x00}   // Le
    };

    // Note: Response is encrypted and MAC'd in authenticated mode
    // Full implementation requires secure messaging decryption
    return TransceiveNative(cmd, uid_buffer);
  }

  /// Read data from a file.
  /// @param session Session token
  /// @param file_number File number (1-3)
  /// @param offset Offset in file
  /// @param length Number of bytes to read
  /// @param buffer Buffer for data
  pw::Result<size_t> ReadData(const Ntag424Session& session,
                              uint8_t file_number,
                              size_t offset,
                              size_t length,
                              pw::ByteSpan buffer) {
    if (!session.is_valid() || !is_authenticated()) {
      return pw::Status::Unauthenticated();
    }

    // ReadData: CLA=0x90, INS=0xAD
    // Data: [FileNo] [Offset 3 bytes LE] [Length 3 bytes LE]
    std::array<std::byte, 12> cmd = {
        std::byte{ntag424_cmd::kClaNative},
        std::byte{ntag424_cmd::kReadData},
        std::byte{0x00},  // P1
        std::byte{0x00},  // P2
        std::byte{0x07},  // Lc: 7 bytes data
        std::byte{file_number},
        std::byte{static_cast<uint8_t>(offset & 0xFF)},
        std::byte{static_cast<uint8_t>((offset >> 8) & 0xFF)},
        std::byte{static_cast<uint8_t>((offset >> 16) & 0xFF)},
        std::byte{static_cast<uint8_t>(length & 0xFF)},
        std::byte{static_cast<uint8_t>((length >> 8) & 0xFF)},
        std::byte{static_cast<uint8_t>((length >> 16) & 0xFF)},
    };

    // Note: Response is encrypted and MAC'd in authenticated mode
    return TransceiveNative(cmd, buffer);
  }

 protected:
  void OnInvalidated() override {
    Ntag424TagBase::ClearSession();
  }

 private:
  /// Send a native NTAG424 command and receive response.
  /// Handles status word checking and additional frames.
  pw::Result<size_t> TransceiveNative(pw::ConstByteSpan command,
                                      pw::ByteSpan response_buffer) {
    auto result = this->Transceive(command, response_buffer, kDefaultTimeout);
    if (!result.ok()) {
      return result.status();
    }

    size_t len = result.value();
    if (len < 2) {
      return pw::Status::DataLoss();
    }

    // Check status word
    uint8_t sw1 = static_cast<uint8_t>(response_buffer[len - 2]);
    uint8_t sw2 = static_cast<uint8_t>(response_buffer[len - 1]);

    if (sw1 == 0x91 && sw2 == 0x00) {
      // Success
      return len - 2;  // Exclude status bytes
    } else if (sw1 == 0x91 && sw2 == 0xAF) {
      // Additional frame - would need to send 0xAF to get more data
      // For now, return what we have
      return len - 2;
    } else {
      // Error - map to pw::Status
      return InterpretStatusWord(sw1, sw2);
    }
  }

  /// Interpret NTAG424 status word as pw::Status.
  static pw::Status InterpretStatusWord(uint8_t sw1, uint8_t sw2) {
    if (sw1 == 0x91) {
      switch (sw2) {
        case 0x00: return pw::OkStatus();
        case 0xAF: return pw::OkStatus();  // Additional frame
        case 0x1C: return pw::Status::InvalidArgument();  // Illegal command
        case 0x1E: return pw::Status::DataLoss();         // Integrity error
        case 0x40: return pw::Status::NotFound();         // No such key
        case 0x7E: return pw::Status::InvalidArgument();  // Length error
        case 0x9D: return pw::Status::PermissionDenied(); // Permission denied
        case 0x9E: return pw::Status::InvalidArgument();  // Parameter error
        case 0xAE: return pw::Status::Unauthenticated();  // Auth error
        case 0xBE: return pw::Status::OutOfRange();       // Boundary error
        case 0xCA: return pw::Status::Aborted();          // Command aborted
        case 0xEE: return pw::Status::Internal();         // Memory error
        default:   return pw::Status::Unknown();
      }
    }
    if (sw1 == 0x90 && sw2 == 0x00) return pw::OkStatus();
    return pw::Status::Unknown();
  }
};

}  // namespace maco::nfc
