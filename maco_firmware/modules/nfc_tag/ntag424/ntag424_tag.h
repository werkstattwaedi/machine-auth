// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>

#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/nfc_tag/iso14443_tag.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_crypto.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_key_provider.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_secure_messaging.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_session.h"
#include "pw_async2/coro.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace maco::nfc {

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

/// Communication mode for file operations.
enum class CommMode : uint8_t {
  kPlain = 0x00,  // No encryption or MAC
  kMac = 0x01,    // Response MAC only
  kFull = 0x03,   // Full encryption + MAC
};

/// NTAG424 DNA tag with async operations using C++20 coroutines.
///
/// All operations are coroutines that can be co_await'ed. The caller must
/// provide a CoroContext for coroutine frame allocation.
///
/// Authenticated operations require an Ntag424Session proof token obtained
/// from Authenticate(). The session state (keys, counters) is managed
/// internally; the token just proves authentication happened.
class Ntag424Tag : public Iso14443Tag {
 public:
  /// Default command timeout.
  static constexpr auto kDefaultTimeout = std::chrono::milliseconds(500);

  /// Construct from Iso14443Tag components.
  Ntag424Tag(NfcReader& reader, const TagInfo& info);

  ~Ntag424Tag();

  // Non-copyable and non-movable (inherits from Iso14443Tag with atomic)
  Ntag424Tag(const Ntag424Tag&) = delete;
  Ntag424Tag& operator=(const Ntag424Tag&) = delete;
  Ntag424Tag(Ntag424Tag&&) = delete;
  Ntag424Tag& operator=(Ntag424Tag&&) = delete;

  /// Clear the session (e.g., on tag removal).
  /// Invalidates any outstanding Ntag424Session tokens.
  void ClearSession();

  // --- Unauthenticated Operations ---

  /// Select the NTAG424 DNA application.
  /// Must be called before authentication.
  pw::async2::Coro<pw::Status> SelectApplication(pw::async2::CoroContext& cx);

  /// Get tag version information (diagnostic command, no auth required).
  /// Logs hardware version, software version, and production info.
  pw::async2::Coro<pw::Status> GetVersion(pw::async2::CoroContext& cx);

  // --- Authentication ---

  /// Authenticate with a key provider.
  /// Implements AuthenticateEV2First (3-pass mutual authentication).
  /// @param cx Coroutine context for frame allocation
  /// @param key_provider Provides key number and crypto operations
  /// @return Coroutine resolving to Session proof token on success
  pw::async2::Coro<pw::Result<Ntag424Session>> Authenticate(
      pw::async2::CoroContext& cx,
      Ntag424KeyProvider& key_provider);

  // --- Authenticated Operations ---
  // All require a valid Ntag424Session from Authenticate().
  // Returns FailedPrecondition if session is invalid or stale.

  /// Get the true 7-byte card UID.
  /// @param cx Coroutine context for frame allocation
  /// @param session Proof token from Authenticate()
  /// @param uid_buffer Buffer for UID (minimum 7 bytes)
  /// @return Coroutine resolving to UID length
  pw::async2::Coro<pw::Result<size_t>> GetCardUid(
      pw::async2::CoroContext& cx,
      const Ntag424Session& session,
      pw::ByteSpan uid_buffer);

  /// Read data from a file.
  ///
  /// @note This implementation does not support ISO-DEP chaining. If the
  /// response requires chaining (status 91 AF), Unimplemented is returned.
  /// In Full communication mode, the maximum safe read size is ~47 bytes
  /// (response = ciphertext + 8-byte CMACt + padding, limited to single
  /// frame). For larger reads, split into multiple operations.
  ///
  /// @param cx Coroutine context for frame allocation
  /// @param session Proof token from Authenticate()
  /// @param file_number File number (0x01-0x03 for standard files)
  /// @param offset Starting offset within file
  /// @param length Number of bytes to read (0 = read to end)
  /// @param data_buffer Buffer for read data
  /// @param comm_mode Communication mode (must match file settings)
  /// @return Coroutine resolving to bytes read, or Unimplemented if chaining needed
  pw::async2::Coro<pw::Result<size_t>> ReadData(
      pw::async2::CoroContext& cx,
      const Ntag424Session& session,
      uint8_t file_number,
      uint32_t offset,
      uint32_t length,
      pw::ByteSpan data_buffer,
      CommMode comm_mode = CommMode::kFull);

  /// Write data to a file.
  /// @param cx Coroutine context for frame allocation
  /// @param session Proof token from Authenticate()
  /// @param file_number File number (0x01-0x03 for standard files)
  /// @param offset Starting offset within file
  /// @param data Data to write
  /// @param comm_mode Communication mode (must match file settings)
  /// @return Coroutine resolving to success status
  pw::async2::Coro<pw::Status> WriteData(pw::async2::CoroContext& cx,
                                          const Ntag424Session& session,
                                          uint8_t file_number,
                                          uint32_t offset,
                                          pw::ConstByteSpan data,
                                          CommMode comm_mode = CommMode::kFull);

  /// Change a key on the tag (requires authentication with key 0).
  ///
  /// For changing the authentication key (key 0), only the new key is needed.
  /// For changing other keys, the old key must be provided for XOR encryption.
  ///
  /// Note: Changing the authentication key (key 0) invalidates the session.
  ///
  /// @param cx Coroutine context for frame allocation
  /// @param session Proof token from Authenticate()
  /// @param key_number Key number to change (0-4)
  /// @param new_key New 16-byte key
  /// @param new_key_version Key version byte (optional)
  /// @param old_key Old 16-byte key (required for non-key-0 changes)
  /// @return Coroutine resolving to success status
  pw::async2::Coro<pw::Status> ChangeKey(pw::async2::CoroContext& cx,
                                          const Ntag424Session& session,
                                          uint8_t key_number,
                                          pw::ConstByteSpan new_key,
                                          uint8_t new_key_version = 0x00,
                                          pw::ConstByteSpan old_key = {});

 private:
  /// Interpret NTAG424 status word as pw::Status.
  static pw::Status InterpretStatusWord(uint8_t sw1, uint8_t sw2);

  /// Transceive helper that wraps the Iso14443Tag::Transceive future.
  pw::async2::Coro<pw::Result<size_t>> DoTransceive(
      pw::async2::CoroContext& cx,
      pw::ConstByteSpan command,
      pw::ByteSpan response);

  /// Validate that a session token matches the current authentication state.
  /// @return OkStatus if valid, FailedPrecondition if stale or no session
  pw::Status ValidateSession(const Ntag424Session& session);

  /// Get current secure messaging context (nullptr if not authenticated).
  SecureMessaging* secure_messaging() {
    return secure_messaging_ ? &*secure_messaging_ : nullptr;
  }

  /// Session state (created after authentication).
  std::optional<SecureMessaging> secure_messaging_;

  /// Key number used for current authentication.
  uint8_t authenticated_key_number_ = 0;

  /// Authentication serial - incremented on each Authenticate() call.
  /// Used to detect stale session tokens.
  uint32_t auth_serial_ = 0;
};

}  // namespace maco::nfc
