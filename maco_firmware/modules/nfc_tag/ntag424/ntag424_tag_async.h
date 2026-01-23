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
#include "pw_async2/future.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_random/random.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace maco::nfc {

// Forward declarations
class Ntag424Tag;
class SelectApplicationFuture;
class AuthenticateFuture;
class GetCardUidFuture;
class ReadDataFuture;
class WriteDataFuture;
class ChangeKeyFuture;

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

/// NTAG424 DNA tag with async operations.
///
/// Operations return futures that must be polled until complete.
/// Session state is managed internally after successful authentication.
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

  // --- Session State ---

  /// Check if currently authenticated.
  bool is_authenticated() const { return secure_messaging_.has_value(); }

  /// Clear the session (e.g., on tag removal).
  void ClearSession();

  // --- Operations (all return futures) ---

  /// Select the NTAG424 DNA application.
  /// Must be called before authentication.
  SelectApplicationFuture SelectApplication();

  /// Authenticate with a key provider.
  /// Implements AuthenticateEV2First (3-pass mutual authentication).
  /// @param key_provider Provides key number and crypto operations
  /// @param random_generator Random number generator for RndA
  /// @return Future resolving to Session on success
  AuthenticateFuture Authenticate(Ntag424KeyProvider& key_provider,
                                  pw::random::RandomGenerator& random_generator);

  /// Get the true 7-byte card UID (requires authentication).
  /// @param uid_buffer Buffer for UID (minimum 7 bytes)
  /// @return Future resolving to UID length
  GetCardUidFuture GetCardUid(pw::ByteSpan uid_buffer);

  /// Read data from a file (requires authentication).
  /// @param file_number File number (0x01-0x03 for standard files)
  /// @param offset Starting offset within file (3 bytes, 0-255 typically)
  /// @param length Number of bytes to read (0 = read to end of file)
  /// @param data_buffer Buffer for read data
  /// @param comm_mode Communication mode (must match file settings)
  /// @return Future resolving to bytes read
  ReadDataFuture ReadData(uint8_t file_number,
                          uint32_t offset,
                          uint32_t length,
                          pw::ByteSpan data_buffer,
                          CommMode comm_mode = CommMode::kFull);

  /// Write data to a file (requires authentication).
  /// @param file_number File number (0x01-0x03 for standard files)
  /// @param offset Starting offset within file
  /// @param data Data to write
  /// @param comm_mode Communication mode (must match file settings)
  /// @return Future resolving to success status
  WriteDataFuture WriteData(uint8_t file_number,
                            uint32_t offset,
                            pw::ConstByteSpan data,
                            CommMode comm_mode = CommMode::kFull);

  /// Change a key on the tag (requires authentication with key 0).
  ///
  /// For changing the authentication key (key 0), only the new key is needed.
  /// For changing other keys, the old key must be provided for XOR encryption.
  ///
  /// @param key_number Key number to change (0-4)
  /// @param new_key New 16-byte key
  /// @param new_key_version Key version byte (optional, for key identification)
  /// @param old_key Old 16-byte key (required for non-key-0 changes)
  /// @return Future resolving to success status
  ChangeKeyFuture ChangeKey(uint8_t key_number,
                            pw::ConstByteSpan new_key,
                            uint8_t new_key_version = 0x00,
                            pw::ConstByteSpan old_key = {});

 private:
  friend class SelectApplicationFuture;
  friend class AuthenticateFuture;
  friend class GetCardUidFuture;
  friend class ReadDataFuture;
  friend class WriteDataFuture;
  friend class ChangeKeyFuture;

  /// Interpret NTAG424 status word as pw::Status.
  static pw::Status InterpretStatusWord(uint8_t sw1, uint8_t sw2);

  /// Set session state after successful authentication.
  void SetSecureMessaging(pw::ConstByteSpan ses_auth_enc_key,
                          pw::ConstByteSpan ses_auth_mac_key,
                          pw::ConstByteSpan ti);

  /// Create a session token (only callable by friends).
  Ntag424Session CreateSession(uint8_t key_number);

  /// Get current secure messaging context.
  SecureMessaging* secure_messaging() {
    return secure_messaging_ ? &*secure_messaging_ : nullptr;
  }

  /// Session state (created after authentication).
  std::optional<SecureMessaging> secure_messaging_;

  /// Key number used for authentication.
  uint8_t authenticated_key_number_ = 0;

  /// Future providers (enforce single operation at a time per type).
  pw::async2::SingleFutureProvider<SelectApplicationFuture> select_provider_;
  pw::async2::SingleFutureProvider<AuthenticateFuture> auth_provider_;
  pw::async2::SingleFutureProvider<GetCardUidFuture> get_uid_provider_;
  pw::async2::SingleFutureProvider<ReadDataFuture> read_data_provider_;
  pw::async2::SingleFutureProvider<WriteDataFuture> write_data_provider_;
  pw::async2::SingleFutureProvider<ChangeKeyFuture> change_key_provider_;
};

// ============================================================================
// SelectApplicationFuture
// ============================================================================

/// Future for SelectApplication operation.
class SelectApplicationFuture
    : public pw::async2::ListableFutureWithWaker<SelectApplicationFuture,
                                                  pw::Status> {
 public:
  using Base = pw::async2::ListableFutureWithWaker<SelectApplicationFuture,
                                                    pw::Status>;
  static constexpr const char kWaitReason[] = "Ntag424SelectApp";

  ~SelectApplicationFuture() = default;

  // Move-only
  SelectApplicationFuture(SelectApplicationFuture&&) noexcept;
  SelectApplicationFuture& operator=(SelectApplicationFuture&&) noexcept;
  SelectApplicationFuture(const SelectApplicationFuture&) = delete;
  SelectApplicationFuture& operator=(const SelectApplicationFuture&) = delete;

 private:
  friend class Ntag424Tag;
  friend Base;

  SelectApplicationFuture(
      pw::async2::SingleFutureProvider<SelectApplicationFuture>& provider,
      Ntag424Tag& tag);

  pw::async2::Poll<pw::Status> DoPend(pw::async2::Context& cx);

  enum class State {
    kSending,
    kWaiting,
  };

  Ntag424Tag* tag_;
  State state_;

  // Command and response buffers (must outlive the transceive future)
  std::array<std::byte, 13> command_;
  std::array<std::byte, 4> response_;
  std::optional<TransceiveFuture> transceive_future_;
};

// ============================================================================
// AuthenticateFuture
// ============================================================================

/// Future for Authenticate operation.
/// Implements 3-pass mutual authentication (AuthenticateEV2First).
class AuthenticateFuture
    : public pw::async2::ListableFutureWithWaker<AuthenticateFuture,
                                                  pw::Result<Ntag424Session>> {
 public:
  using Base = pw::async2::ListableFutureWithWaker<AuthenticateFuture,
                                                    pw::Result<Ntag424Session>>;
  static constexpr const char kWaitReason[] = "Ntag424Auth";

  /// Destructor - securely zeros sensitive key material.
  ~AuthenticateFuture();

  // Move-only
  AuthenticateFuture(AuthenticateFuture&&) noexcept;
  AuthenticateFuture& operator=(AuthenticateFuture&&) noexcept;
  AuthenticateFuture(const AuthenticateFuture&) = delete;
  AuthenticateFuture& operator=(const AuthenticateFuture&) = delete;

 private:
  friend class Ntag424Tag;
  friend Base;

  AuthenticateFuture(
      pw::async2::SingleFutureProvider<AuthenticateFuture>& provider,
      Ntag424Tag& tag,
      Ntag424KeyProvider& key_provider,
      pw::random::RandomGenerator& random_generator);

  pw::async2::Poll<pw::Result<Ntag424Session>> DoPend(pw::async2::Context& cx);

  /// Process Part 1 response and prepare Part 2 command.
  pw::Status ProcessPart1Response();

  /// Process Part 2 response and establish session.
  pw::Result<Ntag424Session> ProcessPart2Response();

  enum class State {
    kSendingPart1,
    kWaitingPart1,
    kSendingPart2,
    kWaitingPart2,
    kCompleted,
    kFailed,
  };

  Ntag424Tag* tag_;
  Ntag424KeyProvider* key_provider_;
  pw::random::RandomGenerator* random_generator_;
  State state_;

  // Buffers for command/response
  std::array<std::byte, 8> part1_command_;
  std::array<std::byte, 20> part1_response_;  // 16 + 2 SW + margin

  std::array<std::byte, 38> part2_command_;
  std::array<std::byte, 36> part2_response_;  // 32 + 2 SW + margin

  // Authentication state
  std::array<std::byte, 16> rnd_a_;
  AuthComputeResult auth_result_;

  std::optional<TransceiveFuture> transceive_future_;
};

// ============================================================================
// GetCardUidFuture
// ============================================================================

/// Future for GetCardUid operation.
/// Requires prior authentication.
class GetCardUidFuture
    : public pw::async2::ListableFutureWithWaker<GetCardUidFuture,
                                                  pw::Result<size_t>> {
 public:
  using Base = pw::async2::ListableFutureWithWaker<GetCardUidFuture,
                                                    pw::Result<size_t>>;
  static constexpr const char kWaitReason[] = "Ntag424GetUid";

  ~GetCardUidFuture() = default;

  // Move-only
  GetCardUidFuture(GetCardUidFuture&&) noexcept;
  GetCardUidFuture& operator=(GetCardUidFuture&&) noexcept;
  GetCardUidFuture(const GetCardUidFuture&) = delete;
  GetCardUidFuture& operator=(const GetCardUidFuture&) = delete;

 private:
  friend class Ntag424Tag;
  friend Base;

  GetCardUidFuture(
      pw::async2::SingleFutureProvider<GetCardUidFuture>& provider,
      Ntag424Tag& tag,
      pw::ByteSpan uid_buffer);

  pw::async2::Poll<pw::Result<size_t>> DoPend(pw::async2::Context& cx);

  /// Process the encrypted response and extract UID.
  pw::Result<size_t> ProcessResponse(size_t response_len);

  enum class State {
    kSending,
    kWaiting,
    kCompleted,
    kFailed,
  };

  Ntag424Tag* tag_;
  pw::ByteSpan uid_buffer_;
  State state_;

  // Command includes CMACt (8 bytes)
  // GetCardUID: 90 51 00 00 08 [CMACt(8)] 00
  std::array<std::byte, 14> command_;

  // Response: Encrypted UID (16 bytes) + CMACt (8 bytes) + SW (2)
  std::array<std::byte, 28> response_;

  std::optional<TransceiveFuture> transceive_future_;
};

// ============================================================================
// ReadDataFuture
// ============================================================================

/// Future for ReadData operation.
/// Requires prior authentication. Handles Full communication mode.
class ReadDataFuture
    : public pw::async2::ListableFutureWithWaker<ReadDataFuture,
                                                  pw::Result<size_t>> {
 public:
  using Base = pw::async2::ListableFutureWithWaker<ReadDataFuture,
                                                    pw::Result<size_t>>;
  static constexpr const char kWaitReason[] = "Ntag424ReadData";

  /// Maximum data that can be read in a single frame.
  /// NTAG424 frame size is ~60 bytes data + overhead.
  static constexpr size_t kMaxFrameDataSize = 48;

  ~ReadDataFuture() = default;

  // Move-only
  ReadDataFuture(ReadDataFuture&&) noexcept;
  ReadDataFuture& operator=(ReadDataFuture&&) noexcept;
  ReadDataFuture(const ReadDataFuture&) = delete;
  ReadDataFuture& operator=(const ReadDataFuture&) = delete;

 private:
  friend class Ntag424Tag;
  friend Base;

  ReadDataFuture(
      pw::async2::SingleFutureProvider<ReadDataFuture>& provider,
      Ntag424Tag& tag,
      uint8_t file_number,
      uint32_t offset,
      uint32_t length,
      pw::ByteSpan data_buffer,
      CommMode comm_mode);

  pw::async2::Poll<pw::Result<size_t>> DoPend(pw::async2::Context& cx);

  /// Process response and decrypt/verify data.
  pw::Result<size_t> ProcessResponse(size_t response_len);

  enum class State {
    kSending,
    kWaiting,
    kChaining,     // Receiving additional frames (0x91 AF)
    kCompleted,
    kFailed,
  };

  Ntag424Tag* tag_;
  pw::ByteSpan data_buffer_;
  uint8_t file_number_;
  uint32_t offset_;
  uint32_t length_;
  CommMode comm_mode_;
  State state_;
  size_t total_bytes_read_ = 0;

  // Command: 90 AD 00 00 Lc [FileNo] [Offset(3)] [Length(3)] [CMACt(8)] 00
  // Lc = 1 + 3 + 3 + 8 = 15
  std::array<std::byte, 22> command_;

  // Response: max encrypted data (rounded to 16) + CMACt (8) + SW (2) + margin
  std::array<std::byte, 80> response_;

  std::optional<TransceiveFuture> transceive_future_;
};

// ============================================================================
// WriteDataFuture
// ============================================================================

/// Future for WriteData operation.
/// Requires prior authentication. Handles Full communication mode.
class WriteDataFuture
    : public pw::async2::ListableFutureWithWaker<WriteDataFuture, pw::Status> {
 public:
  using Base = pw::async2::ListableFutureWithWaker<WriteDataFuture, pw::Status>;
  static constexpr const char kWaitReason[] = "Ntag424WriteData";

  /// Maximum data that can be written in a single frame.
  static constexpr size_t kMaxFrameDataSize = 48;

  ~WriteDataFuture() = default;

  // Move-only
  WriteDataFuture(WriteDataFuture&&) noexcept;
  WriteDataFuture& operator=(WriteDataFuture&&) noexcept;
  WriteDataFuture(const WriteDataFuture&) = delete;
  WriteDataFuture& operator=(const WriteDataFuture&) = delete;

 private:
  friend class Ntag424Tag;
  friend Base;

  WriteDataFuture(
      pw::async2::SingleFutureProvider<WriteDataFuture>& provider,
      Ntag424Tag& tag,
      uint8_t file_number,
      uint32_t offset,
      pw::ConstByteSpan data,
      CommMode comm_mode);

  pw::async2::Poll<pw::Status> DoPend(pw::async2::Context& cx);

  /// Build the initial write command.
  pw::Status BuildCommand();

  /// Process response and verify MAC.
  pw::Status ProcessResponse(size_t response_len);

  enum class State {
    kSending,
    kWaiting,
    kCompleted,
    kFailed,
  };

  Ntag424Tag* tag_;
  pw::ConstByteSpan data_;
  uint8_t file_number_;
  uint32_t offset_;
  CommMode comm_mode_;
  State state_;

  // Command buffer - includes header + encrypted data + CMACt
  // Max: 5 (APDU header) + 1 (FileNo) + 3 (Offset) + 3 (Length)
  //      + 64 (padded data) + 8 (CMACt) + 1 (Le) = 85 bytes
  std::array<std::byte, 96> command_;
  size_t command_len_ = 0;

  // Response: CMACt (8) + SW (2) = 10 bytes + margin
  std::array<std::byte, 16> response_;

  std::optional<TransceiveFuture> transceive_future_;
};

// ============================================================================
// ChangeKeyFuture
// ============================================================================

/// Future for ChangeKey operation.
/// Requires prior authentication (typically with key 0 for changing other keys).
///
/// Key change data format:
/// - Key 0: EncryptedData = AES-CBC(IVCmd, NewKey || Version || Padding)
/// - Other keys: EncryptedData = AES-CBC(IVCmd, (NewKey XOR OldKey) || Version
/// || CRC32NK(NewKey) || Padding)
///
/// Reference: NXP AN12196 Section 6.4.1 ChangeKey
class ChangeKeyFuture
    : public pw::async2::ListableFutureWithWaker<ChangeKeyFuture, pw::Status> {
 public:
  using Base = pw::async2::ListableFutureWithWaker<ChangeKeyFuture, pw::Status>;
  static constexpr const char kWaitReason[] = "Ntag424ChangeKey";

  /// Destructor - securely zeros sensitive key material.
  ~ChangeKeyFuture();

  // Move-only
  ChangeKeyFuture(ChangeKeyFuture&&) noexcept;
  ChangeKeyFuture& operator=(ChangeKeyFuture&&) noexcept;
  ChangeKeyFuture(const ChangeKeyFuture&) = delete;
  ChangeKeyFuture& operator=(const ChangeKeyFuture&) = delete;

 private:
  friend class Ntag424Tag;
  friend Base;

  ChangeKeyFuture(pw::async2::SingleFutureProvider<ChangeKeyFuture>& provider,
                  Ntag424Tag& tag,
                  uint8_t key_number,
                  pw::ConstByteSpan new_key,
                  uint8_t new_key_version,
                  pw::ConstByteSpan old_key);

  pw::async2::Poll<pw::Status> DoPend(pw::async2::Context& cx);

  /// Build the encrypted key change data.
  pw::Status BuildCommand();

  /// Process response and verify MAC.
  pw::Status ProcessResponse(size_t response_len);

  enum class State {
    kSending,
    kWaiting,
    kCompleted,
    kFailed,
  };

  Ntag424Tag* tag_;
  uint8_t key_number_;
  std::array<std::byte, 16> new_key_;
  uint8_t new_key_version_;
  std::array<std::byte, 16> old_key_;
  bool has_old_key_ = false;
  State state_;

  // Command buffer:
  // 90 C4 00 00 Lc [KeyNo] [EncryptedData(32)] [CMACt(8)] 00
  // Lc = 1 + 32 + 8 = 41 for key 0
  // Lc = 1 + 32 + 8 = 41 for other keys (CRC32 is included in 32-byte encrypted
  // block)
  std::array<std::byte, 48> command_;
  size_t command_len_ = 0;

  // Response: CMACt (8) + SW (2) = 10 bytes + margin
  std::array<std::byte, 16> response_;

  std::optional<TransceiveFuture> transceive_future_;
};

}  // namespace maco::nfc
