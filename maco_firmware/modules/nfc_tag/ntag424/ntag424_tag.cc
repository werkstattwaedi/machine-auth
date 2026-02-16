// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "ntag424"

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag.h"

#include <algorithm>
#include <cstring>

#include "pw_log/log.h"
#include "pw_status/try.h"

namespace maco::nfc {

// ============================================================================
// Ntag424Tag
// ============================================================================

Ntag424Tag::Ntag424Tag(NfcReader& reader, const TagInfo& info)
    : Iso14443Tag(reader, info) {}

Ntag424Tag::~Ntag424Tag() { ClearSession(); }

void Ntag424Tag::ClearSession() {
  secure_messaging_.reset();
  authenticated_key_number_ = 0;
  // Note: auth_serial_ is NOT reset - stale tokens should still fail
}

pw::Status Ntag424Tag::ValidateSession(const Ntag424Session& session) {
  if (!secure_messaging_.has_value()) {
    return pw::Status::FailedPrecondition();
  }
  if (session.auth_serial_ != auth_serial_) {
    return pw::Status::FailedPrecondition();
  }
  return pw::OkStatus();
}

pw::Status Ntag424Tag::InterpretStatusWord(uint8_t sw1, uint8_t sw2) {
  if (sw1 == 0x91) {
    switch (sw2) {
      case 0x00:
        return pw::OkStatus();
      case 0xAF:
        return pw::OkStatus();  // Additional frame
      case 0x1C:
        return pw::Status::InvalidArgument();  // Illegal command
      case 0x1E:
        return pw::Status::DataLoss();  // Integrity error
      case 0x40:
        return pw::Status::NotFound();  // No such key
      case 0x7E:
        return pw::Status::InvalidArgument();  // Length error
      case 0x9D:
        return pw::Status::PermissionDenied();  // Permission denied
      case 0x9E:
        return pw::Status::InvalidArgument();  // Parameter error
      case 0xAE:
        return pw::Status::Unauthenticated();  // Auth error
      case 0xBE:
        return pw::Status::OutOfRange();  // Boundary error
      case 0xCA:
        return pw::Status::Aborted();  // Command aborted
      case 0xEE:
        return pw::Status::Internal();  // Memory error
      default:
        return pw::Status::Unknown();
    }
  }
  if (sw1 == 0x90 && sw2 == 0x00) return pw::OkStatus();
  return pw::Status::Unknown();
}

// ============================================================================
// DoTransceive - Helper coroutine
// ============================================================================

pw::async2::Coro<pw::Result<size_t>> Ntag424Tag::DoTransceive(
    [[maybe_unused]] pw::async2::CoroContext& cx,
    pw::ConstByteSpan command,
    pw::ByteSpan response) {
  // Create the future from Iso14443Tag::Transceive
  auto future = Transceive(command, response, kDefaultTimeout);
  // co_await the future - Coro<T> can await any Future<T>
  co_return co_await future;
}

// ============================================================================
// SelectApplication
// ============================================================================

pw::async2::Coro<pw::Status> Ntag424Tag::SelectApplication(
    pw::async2::CoroContext& cx) {
  // Build ISOSelectFile command:
  // CLA=0x00, INS=0xA4, P1=0x04, P2=0x0C
  // Data: DF name = D2 76 00 00 85 01 01
  std::array<std::byte, 13> command = {
      std::byte{ntag424_cmd::kClaIso},
      std::byte{ntag424_cmd::kIsoSelectFile},
      std::byte{0x04},  // P1: Select by DF name
      std::byte{0x0C},  // P2: No response data
      std::byte{0x07},  // Lc: 7 bytes
      std::byte{0xD2}, std::byte{0x76}, std::byte{0x00}, std::byte{0x00},
      std::byte{0x85}, std::byte{0x01}, std::byte{0x01},
      std::byte{0x00}};  // Le

  std::array<std::byte, 4> response;
  PW_CO_TRY_ASSIGN(size_t len, co_await DoTransceive(cx, command, response));
  if (len < 2) {
    co_return pw::Status::DataLoss();
  }

  // Check status word (SW1=0x90, SW2=0x00 for success)
  uint8_t sw1 = static_cast<uint8_t>(response[len - 2]);
  uint8_t sw2 = static_cast<uint8_t>(response[len - 1]);
  if (sw1 != 0x90 || sw2 != 0x00) {
    co_return InterpretStatusWord(sw1, sw2);
  }

  co_return pw::OkStatus();
}

// ============================================================================
// Authenticate
// ============================================================================

pw::async2::Coro<pw::Result<Ntag424Session>> Ntag424Tag::Authenticate(
    pw::async2::CoroContext& cx,
    Ntag424KeyProvider& key_provider) {
  // Clear any existing session
  ClearSession();

  // --- Part 1: Send AuthenticateEV2First command ---
  // Command: 90 71 00 00 02 [KeyNo] [LenCap=0x00] 00
  std::array<std::byte, 8> part1_command = {
      std::byte{ntag424_cmd::kClaNative},
      std::byte{ntag424_cmd::kAuthenticateEv2First},
      std::byte{0x00},  // P1
      std::byte{0x00},  // P2
      std::byte{0x02},  // Lc: 2 bytes
      std::byte{key_provider.key_number()},
      std::byte{0x00},   // LenCap (no PCDcap2)
      std::byte{0x00}};  // Le

  std::array<std::byte, 20> part1_response;  // 16 + 2 SW + margin
  PW_CO_TRY_ASSIGN(size_t part1_len,
                   co_await DoTransceive(cx, part1_command, part1_response));
  if (part1_len < 18) {  // 16 encrypted RndB + 2 SW
    co_return pw::Status::DataLoss();
  }

  uint8_t sw1 = static_cast<uint8_t>(part1_response[part1_len - 2]);
  uint8_t sw2 = static_cast<uint8_t>(part1_response[part1_len - 1]);
  if (sw1 != 0x91 || sw2 != 0xAF) {
    co_return InterpretStatusWord(sw1, sw2);
  }

  // --- Process Part 1 response and prepare Part 2 ---
  // Extract encrypted RndB (first 16 bytes)
  pw::ConstByteSpan encrypted_rnd_b(part1_response.data(), 16);

  // Key provider creates Part 2 response (generates RndA internally)
  PW_CO_TRY_ASSIGN(auto part2_data,
                   co_await key_provider.CreateNtagChallenge(cx, encrypted_rnd_b));

  // --- Part 2: Send additional frame with encrypted response ---
  // Command: 90 AF 00 00 20 [32 bytes encrypted data] 00
  std::array<std::byte, 38> part2_command;
  part2_command[0] = std::byte{ntag424_cmd::kClaNative};
  part2_command[1] = std::byte{ntag424_cmd::kAdditionalFrame};
  part2_command[2] = std::byte{0x00};  // P1
  part2_command[3] = std::byte{0x00};  // P2
  part2_command[4] = std::byte{0x20};  // Lc: 32 bytes
  std::copy(part2_data.begin(), part2_data.end(), part2_command.begin() + 5);
  part2_command[37] = std::byte{0x00};  // Le

  std::array<std::byte, 36> part2_response;  // 32 + 2 SW + margin
  auto part2_result = co_await DoTransceive(cx, part2_command, part2_response);
  if (!part2_result.ok()) {
    key_provider.CancelAuthentication();
    co_return part2_result.status();
  }

  // --- Process Part 2 response (Part 3 from tag) ---
  // Find actual length by checking for 91 00 status word
  size_t len = 0;
  for (size_t i = 2; i < part2_response.size(); ++i) {
    if (part2_response[i - 2] == std::byte{0x91} &&
        (part2_response[i - 1] == std::byte{0x00} ||
         part2_response[i - 1] == std::byte{0xAF})) {
      len = i;
      break;
    }
  }

  // The response should be at least 34 bytes (32 encrypted + SW 91 00)
  if (len < 34) {
    key_provider.CancelAuthentication();
    co_return pw::Status::DataLoss();
  }

  sw1 = static_cast<uint8_t>(part2_response[len - 2]);
  sw2 = static_cast<uint8_t>(part2_response[len - 1]);
  if (sw1 != 0x91 || sw2 != 0x00) {
    key_provider.CancelAuthentication();
    co_return InterpretStatusWord(sw1, sw2);
  }

  // Key provider verifies RndA' and computes session keys
  // NOTE: Part3 is decrypted with AuthKey, not session keys!
  pw::ConstByteSpan encrypted_part3(part2_response.data(), 32);
  // CancelAuthentication is called by key provider on failure
  PW_CO_TRY_ASSIGN(
      auto session_keys,
      co_await key_provider.VerifyAndComputeSessionKeys(cx, encrypted_part3));

  // Authentication successful - store session state
  secure_messaging_.emplace(session_keys.ses_auth_enc_key,
                            session_keys.ses_auth_mac_key,
                            session_keys.transaction_identifier, 0);
  authenticated_key_number_ = key_provider.key_number();
  ++auth_serial_;

  co_return Ntag424Session(key_provider.key_number(), auth_serial_);
}

// ============================================================================
// GetCardUid
// ============================================================================

pw::async2::Coro<pw::Result<size_t>> Ntag424Tag::GetCardUid(
    pw::async2::CoroContext& cx,
    const Ntag424Session& session,
    pw::ByteSpan uid_buffer) {
  PW_CO_TRY(ValidateSession(session));
  auto* sm = secure_messaging();

  // Build GetCardUID command with CMAC
  // GetCardUID: 90 51 00 00 08 [CMACt(8)] 00
  std::array<std::byte, 14> command;
  command[0] = std::byte{ntag424_cmd::kClaNative};
  command[1] = std::byte{ntag424_cmd::kGetCardUid};
  command[2] = std::byte{0x00};  // P1
  command[3] = std::byte{0x00};  // P2
  command[4] = std::byte{0x08};  // Lc: 8 bytes (CMACt)

  // Build CMACt for the command (no command header for GetCardUID)
  pw::ByteSpan cmac_out(command.data() + 5, 8);
  PW_CO_TRY(sm->BuildCommandCMAC(ntag424_cmd::kGetCardUid, {}, cmac_out));

  command[13] = std::byte{0x00};  // Le

  // Response: Encrypted UID (16 bytes) + CMACt (8 bytes) + SW (2)
  std::array<std::byte, 28> response;
  PW_CO_TRY_ASSIGN(size_t response_len,
                   co_await DoTransceive(cx, command, response));

  // Response format: [EncryptedUID(16)] [CMACt(8)] [SW(2)]
  // Minimum: 16 + 8 + 2 = 26 bytes
  if (response_len < 26) {
    co_return pw::Status::DataLoss();
  }

  // Check status word
  uint8_t sw1 = static_cast<uint8_t>(response[response_len - 2]);
  uint8_t sw2 = static_cast<uint8_t>(response[response_len - 1]);
  if (sw1 != 0x91 || sw2 != 0x00) {
    co_return InterpretStatusWord(sw1, sw2);
  }

  // Extract encrypted data (16 bytes) and CMACt (8 bytes)
  pw::ConstByteSpan encrypted_data(response.data(), 16);
  pw::ConstByteSpan received_cmac(response.data() + 16, 8);

  // Increment counter BEFORE verifying response MAC.
  // The PICC increments CmdCtr before calculating its response MAC,
  // so we must use CmdCtr+1 when verifying. (AN12196 Section 4.3, Figure 9)
  if (!sm->IncrementCounter()) {
    co_return pw::Status::ResourceExhausted();  // Counter overflow
  }

  // Verify response CMAC (over ciphertext per AN12196 Section 4.4)
  PW_CO_TRY(sm->VerifyResponseCMACWithData(0x00, encrypted_data, received_cmac));

  // Decrypt the response after MAC verification
  std::array<std::byte, 16> decrypted;
  size_t plaintext_len;
  PW_CO_TRY(sm->DecryptResponseData(encrypted_data, decrypted, plaintext_len));

  // Copy UID to output buffer (7 bytes)
  if (uid_buffer.size() < plaintext_len) {
    co_return pw::Status::ResourceExhausted();
  }

  std::copy(decrypted.begin(), decrypted.begin() + plaintext_len,
            uid_buffer.begin());

  co_return plaintext_len;
}

// ============================================================================
// ReadData
// ============================================================================

pw::async2::Coro<pw::Result<size_t>> Ntag424Tag::ReadData(
    pw::async2::CoroContext& cx,
    const Ntag424Session& session,
    uint8_t file_number,
    uint32_t offset,
    uint32_t length,
    pw::ByteSpan data_buffer,
    CommMode comm_mode) {
  PW_CO_TRY(ValidateSession(session));
  auto* sm = secure_messaging();

  // Build ReadData command
  // Full/MAC mode: 90 AD 00 00 Lc [FileNo] [Offset(3)] [Length(3)] [CMACt(8)] 00
  // Plain mode:    90 AD 00 00 Lc [FileNo] [Offset(3)] [Length(3)] 00
  std::array<std::byte, 22> command;
  command[0] = std::byte{ntag424_cmd::kClaNative};
  command[1] = std::byte{ntag424_cmd::kReadData};
  command[2] = std::byte{0x00};  // P1
  command[3] = std::byte{0x00};  // P2

  // File number
  command[5] = std::byte{file_number};

  // Offset (3 bytes, little-endian)
  command[6] = static_cast<std::byte>(offset & 0xFF);
  command[7] = static_cast<std::byte>((offset >> 8) & 0xFF);
  command[8] = static_cast<std::byte>((offset >> 16) & 0xFF);

  // Length (3 bytes, little-endian)
  command[9] = static_cast<std::byte>(length & 0xFF);
  command[10] = static_cast<std::byte>((length >> 8) & 0xFF);
  command[11] = static_cast<std::byte>((length >> 16) & 0xFF);

  size_t cmd_len;
  if (comm_mode != CommMode::kPlain) {
    // Build CMACt for the command header
    pw::ConstByteSpan cmd_header(command.data() + 5,
                                 7);  // FileNo + Offset + Len
    pw::ByteSpan cmac_out(command.data() + 12, 8);
    PW_CO_TRY(
        sm->BuildCommandCMAC(ntag424_cmd::kReadData, cmd_header, cmac_out));
    command[4] = std::byte{15};     // Lc: 1 + 3 + 3 + 8 = 15
    command[20] = std::byte{0x00};  // Le
    cmd_len = 21;
  } else {
    // Plain mode: no CMACt
    command[4] = std::byte{7};      // Lc: 1 + 3 + 3 = 7
    command[12] = std::byte{0x00};  // Le
    cmd_len = 13;
  }

  // Response: max encrypted data (rounded to 16) + CMACt (8) + SW (2) + margin
  std::array<std::byte, 80> response;
  pw::ConstByteSpan cmd_span(command.data(), cmd_len);
  PW_CO_TRY_ASSIGN(size_t response_len,
                   co_await DoTransceive(cx, cmd_span, response));

  // Minimum response varies by mode:
  // Full/MAC: data + CMACt (8) + SW (2) = minimum 10 bytes
  // Plain: data + SW (2) = minimum 2 bytes
  size_t min_response = (comm_mode == CommMode::kPlain) ? 2 : 10;
  if (response_len < min_response) {
    co_return pw::Status::DataLoss();
  }

  // Check status word
  uint8_t sw1 = static_cast<uint8_t>(response[response_len - 2]);
  uint8_t sw2 = static_cast<uint8_t>(response[response_len - 1]);

  // 91 AF means more data available (chaining)
  // For simplicity, we don't support chaining in this implementation
  if (sw1 == 0x91 && sw2 == 0xAF) {
    co_return pw::Status::Unimplemented();
  }

  if (sw1 != 0x91 || sw2 != 0x00) {
    co_return InterpretStatusWord(sw1, sw2);
  }

  // Calculate data length based on mode
  size_t data_len;
  if (comm_mode == CommMode::kPlain) {
    // Plain mode: response is just [Data][SW]
    data_len = response_len - 2;
  } else {
    // Full/MAC mode: response is [Data][CMACt(8)][SW]
    size_t data_with_cmac_len = response_len - 2;
    if (data_with_cmac_len < 8) {
      co_return pw::Status::DataLoss();
    }
    data_len = data_with_cmac_len - 8;
  }
  size_t total_bytes_read = 0;

  // Increment CmdCtr for every successful command. The PICC always increments
  // regardless of CommMode; we must stay in sync.
  if (!sm->IncrementCounter()) {
    co_return pw::Status::ResourceExhausted();
  }

  if (comm_mode == CommMode::kFull && data_len > 0) {
    // Full mode: Verify CMAC over ciphertext first, then decrypt
    pw::ConstByteSpan encrypted_data(response.data(), data_len);
    pw::ConstByteSpan received_cmac(response.data() + data_len, 8);

    // Verify response CMAC over ciphertext (per AN12196 Section 4.4)
    PW_CO_TRY(
        sm->VerifyResponseCMACWithData(0x00, encrypted_data, received_cmac));

    // Decrypt after MAC verification
    std::array<std::byte, 64> decrypted;
    if (data_len > decrypted.size()) {
      co_return pw::Status::ResourceExhausted();
    }

    size_t plaintext_len;
    PW_CO_TRY(sm->DecryptResponseData(
        encrypted_data, pw::ByteSpan(decrypted.data(), data_len),
        plaintext_len));

    // Copy to output buffer
    if (data_buffer.size() < plaintext_len) {
      co_return pw::Status::ResourceExhausted();
    }
    std::copy(decrypted.begin(), decrypted.begin() + plaintext_len,
              data_buffer.begin());
    total_bytes_read = plaintext_len;

  } else if (comm_mode == CommMode::kMac) {
    // MAC mode: Data is plain, just verify CMAC
    pw::ConstByteSpan plain_data(response.data(), data_len);
    pw::ConstByteSpan received_cmac(response.data() + data_len, 8);

    PW_CO_TRY(sm->VerifyResponseCMACWithData(0x00, plain_data, received_cmac));

    if (data_buffer.size() < data_len) {
      co_return pw::Status::ResourceExhausted();
    }
    std::copy(plain_data.begin(), plain_data.end(), data_buffer.begin());
    total_bytes_read = data_len;

  } else {
    // Plain mode: No encryption, no CMAC verification
    // Response is just data + SW
    if (data_buffer.size() < data_len) {
      co_return pw::Status::ResourceExhausted();
    }
    std::copy(response.begin(), response.begin() + data_len,
              data_buffer.begin());
    total_bytes_read = data_len;
  }

  co_return total_bytes_read;
}

// ============================================================================
// WriteData
// ============================================================================

pw::async2::Coro<pw::Status> Ntag424Tag::WriteData(
    pw::async2::CoroContext& cx,
    const Ntag424Session& session,
    uint8_t file_number,
    uint32_t offset,
    pw::ConstByteSpan data,
    CommMode comm_mode) {
  PW_CO_TRY(ValidateSession(session));
  auto* sm = secure_messaging();

  // WriteData command: 90 8D 00 00 Lc [FileNo] [Offset(3)] [Length(3)] [Data]
  // [CMACt(8)] 00

  // Header position offsets
  constexpr size_t kApduHeaderSize = 5;  // CLA INS P1 P2 Lc
  constexpr size_t kCmdHeaderStart = kApduHeaderSize;
  constexpr size_t kCmdHeaderSize = 7;  // FileNo + Offset(3) + Length(3)
  constexpr size_t kDataStart = kCmdHeaderStart + kCmdHeaderSize;

  // Command buffer - includes header + encrypted data + CMACt
  // Max: 5 (APDU header) + 1 (FileNo) + 3 (Offset) + 3 (Length)
  //      + 64 (padded data) + 8 (CMACt) + 1 (Le) = 85 bytes
  std::array<std::byte, 96> command;

  // Build APDU header
  command[0] = std::byte{ntag424_cmd::kClaNative};
  command[1] = std::byte{ntag424_cmd::kWriteData};
  command[2] = std::byte{0x00};  // P1
  command[3] = std::byte{0x00};  // P2
  // Lc will be filled in after we know the data size

  // Command header: FileNo + Offset(3) + Length(3)
  command[kCmdHeaderStart] = std::byte{file_number};
  command[kCmdHeaderStart + 1] = static_cast<std::byte>(offset & 0xFF);
  command[kCmdHeaderStart + 2] = static_cast<std::byte>((offset >> 8) & 0xFF);
  command[kCmdHeaderStart + 3] = static_cast<std::byte>((offset >> 16) & 0xFF);

  uint32_t length = static_cast<uint32_t>(data.size());
  command[kCmdHeaderStart + 4] = static_cast<std::byte>(length & 0xFF);
  command[kCmdHeaderStart + 5] = static_cast<std::byte>((length >> 8) & 0xFF);
  command[kCmdHeaderStart + 6] = static_cast<std::byte>((length >> 16) & 0xFF);

  size_t data_in_cmd_len = 0;

  if (comm_mode == CommMode::kFull) {
    // Encrypt the data
    // ISO 7816-4 padding ALWAYS adds at least 1 byte, so formula is:
    // padded_size = ((data.size() / 16) + 1) * 16
    size_t padded_size = ((data.size() / 16) + 1) * 16;
    if (padded_size > 64) {
      // Data too large for single frame
      co_return pw::Status::OutOfRange();
    }

    size_t ciphertext_len;
    PW_CO_TRY(sm->EncryptCommandData(
        data, pw::ByteSpan(command.data() + kDataStart, padded_size),
        ciphertext_len));
    data_in_cmd_len = ciphertext_len;

  } else if (comm_mode == CommMode::kMac) {
    // MAC mode: Data is plain
    if (data.size() > 48) {
      co_return pw::Status::OutOfRange();
    }
    std::copy(data.begin(), data.end(), command.begin() + kDataStart);
    data_in_cmd_len = data.size();

  } else {
    // Plain mode: Data is plain, no MAC
    if (data.size() > 48) {
      co_return pw::Status::OutOfRange();
    }
    std::copy(data.begin(), data.end(), command.begin() + kDataStart);
    data_in_cmd_len = data.size();
  }

  // Build CMACt (for Full and MAC modes)
  size_t cmac_pos = kDataStart + data_in_cmd_len;
  if (comm_mode != CommMode::kPlain) {
    pw::ConstByteSpan cmd_header(command.data() + kCmdHeaderStart,
                                  kCmdHeaderSize);
    pw::ConstByteSpan cmd_data(command.data() + kDataStart, data_in_cmd_len);

    PW_CO_TRY(sm->BuildCommandCMACWithData(
        ntag424_cmd::kWriteData, cmd_header, cmd_data,
        pw::ByteSpan(command.data() + cmac_pos, 8)));
    cmac_pos += 8;
  }

  // Set Lc (everything after APDU header except Le)
  size_t lc = kCmdHeaderSize + data_in_cmd_len;
  if (comm_mode != CommMode::kPlain) {
    lc += 8;  // CMACt
  }
  command[4] = static_cast<std::byte>(lc);

  // Le
  command[cmac_pos] = std::byte{0x00};
  size_t command_len = cmac_pos + 1;

  // Response: CMACt (8) + SW (2) = 10 bytes + margin
  std::array<std::byte, 16> response;
  pw::ConstByteSpan cmd_span(command.data(), command_len);
  PW_CO_TRY_ASSIGN(size_t response_len,
                   co_await DoTransceive(cx, cmd_span, response));

  // Response format for Full/MAC mode: [CMACt(8)] [SW(2)] = 10 bytes
  // For Plain mode: [SW(2)] = 2 bytes
  if (response_len < 2) {
    co_return pw::Status::DataLoss();
  }

  // Check status word
  uint8_t sw1 = static_cast<uint8_t>(response[response_len - 2]);
  uint8_t sw2 = static_cast<uint8_t>(response[response_len - 1]);

  if (sw1 != 0x91 || sw2 != 0x00) {
    co_return InterpretStatusWord(sw1, sw2);
  }

  // Increment CmdCtr for every successful command. The PICC always increments
  // regardless of CommMode; we must stay in sync.
  if (!sm->IncrementCounter()) {
    co_return pw::Status::ResourceExhausted();
  }

  // Verify response CMAC for Full and MAC modes
  if (comm_mode != CommMode::kPlain) {
    if (response_len < 10) {
      co_return pw::Status::DataLoss();
    }

    pw::ConstByteSpan received_cmac(response.data(), 8);

    // For write, response has no data, just verify the empty response CMAC
    PW_CO_TRY(sm->VerifyResponseCMAC(0x00, received_cmac));
  }

  co_return pw::OkStatus();
}

// ============================================================================
// GetFileSettings
// ============================================================================

pw::async2::Coro<pw::Result<size_t>> Ntag424Tag::GetFileSettings(
    pw::async2::CoroContext& cx,
    const Ntag424Session& session,
    uint8_t file_number,
    pw::ByteSpan settings_buffer,
    CommMode comm_mode) {
  PW_CO_TRY(ValidateSession(session));
  auto* sm = secure_messaging();

  // Build GetFileSettings command
  // Full mode: 90 F5 00 00 09 [FileNo] [CMACt(8)] 00
  // Plain mode: 90 F5 00 00 01 [FileNo] 00
  std::array<std::byte, 16> command;
  command[0] = std::byte{ntag424_cmd::kClaNative};
  command[1] = std::byte{ntag424_cmd::kGetFileSettings};
  command[2] = std::byte{0x00};  // P1
  command[3] = std::byte{0x00};  // P2

  command[5] = std::byte{file_number};

  size_t cmd_len;

  if (comm_mode == CommMode::kFull) {
    command[4] = std::byte{9};  // Lc: 1 (FileNo) + 8 (CMACt)

    // Build CMACt over command header (FileNo)
    pw::ConstByteSpan cmd_header(command.data() + 5, 1);
    pw::ByteSpan cmac_out(command.data() + 6, 8);
    PW_CO_TRY(sm->BuildCommandCMAC(ntag424_cmd::kGetFileSettings, cmd_header,
                                    cmac_out));

    command[14] = std::byte{0x00};  // Le
    cmd_len = 15;
  } else {
    command[4] = std::byte{1};  // Lc: 1 (FileNo only)
    command[6] = std::byte{0x00};  // Le
    cmd_len = 7;
  }

  // Response: up to 32 bytes data + optional CMACt(8) + SW(2)
  std::array<std::byte, 48> response;
  pw::ConstByteSpan cmd_span(command.data(), cmd_len);
  PW_CO_TRY_ASSIGN(size_t response_len,
                   co_await DoTransceive(cx, cmd_span, response));

  if (response_len < 2) {
    co_return pw::Status::DataLoss();
  }

  uint8_t sw1 = static_cast<uint8_t>(response[response_len - 2]);
  uint8_t sw2 = static_cast<uint8_t>(response[response_len - 1]);
  if (sw1 != 0x91 || sw2 != 0x00) {
    PW_LOG_WARN("GetFileSettings SW=%02X %02X", sw1, sw2);
    co_return InterpretStatusWord(sw1, sw2);
  }

  // Increment CmdCtr for every successful command. The PICC always increments
  // regardless of CommMode; we must stay in sync.
  if (!sm->IncrementCounter()) {
    co_return pw::Status::ResourceExhausted();
  }

  if (comm_mode == CommMode::kFull) {
    // Response format: [EncryptedData(N)] [CMACt(8)] [SW(2)]
    size_t data_with_cmac_len = response_len - 2;
    if (data_with_cmac_len < 8) {
      co_return pw::Status::DataLoss();
    }
    size_t encrypted_len = data_with_cmac_len - 8;

    pw::ConstByteSpan encrypted_data(response.data(), encrypted_len);
    pw::ConstByteSpan received_cmac(response.data() + encrypted_len, 8);

    PW_CO_TRY(
        sm->VerifyResponseCMACWithData(0x00, encrypted_data, received_cmac));

    std::array<std::byte, 32> decrypted;
    if (encrypted_len > decrypted.size()) {
      co_return pw::Status::ResourceExhausted();
    }

    size_t plaintext_len;
    PW_CO_TRY(sm->DecryptResponseData(
        encrypted_data, pw::ByteSpan(decrypted.data(), encrypted_len),
        plaintext_len));

    if (settings_buffer.size() < plaintext_len) {
      co_return pw::Status::ResourceExhausted();
    }
    std::copy(decrypted.begin(), decrypted.begin() + plaintext_len,
              settings_buffer.begin());
    co_return plaintext_len;

  } else {
    // Plain mode: [SettingsData(N)] [SW(2)]
    size_t data_len = response_len - 2;
    if (settings_buffer.size() < data_len) {
      co_return pw::Status::ResourceExhausted();
    }
    std::copy(response.begin(), response.begin() + data_len,
              settings_buffer.begin());
    co_return data_len;
  }
}

// ============================================================================
// ChangeFileSettings
// ============================================================================

pw::async2::Coro<pw::Status> Ntag424Tag::ChangeFileSettings(
    pw::async2::CoroContext& cx,
    const Ntag424Session& session,
    uint8_t file_number,
    pw::ConstByteSpan settings,
    CommMode response_comm_mode) {
  PW_CO_TRY(ValidateSession(session));
  auto* sm = secure_messaging();

  // Command data is always encrypted (NTAG424 spec requirement)
  size_t padded_size = ((settings.size() / 16) + 1) * 16;
  if (padded_size > 32) {
    co_return pw::Status::OutOfRange();
  }

  std::array<std::byte, 32> ciphertext;
  size_t ciphertext_len;
  PW_CO_TRY(sm->EncryptCommandData(settings, ciphertext, ciphertext_len));

  // Build APDU: 90 5F 00 00 Lc [FileNo] [Ciphertext] [CMACt(8)] 00
  std::array<std::byte, 48> command;
  command[0] = std::byte{ntag424_cmd::kClaNative};
  command[1] = std::byte{ntag424_cmd::kChangeFileSettings};
  command[2] = std::byte{0x00};  // P1
  command[3] = std::byte{0x00};  // P2

  // FileNo (not encrypted, part of command header)
  command[5] = std::byte{file_number};

  // Copy ciphertext after FileNo
  std::copy(ciphertext.begin(), ciphertext.begin() + ciphertext_len,
            command.begin() + 6);

  // Build CMACt over [FileNo | Ciphertext]
  pw::ConstByteSpan cmd_header(command.data() + 5, 1);  // FileNo
  pw::ConstByteSpan cmd_data(command.data() + 6, ciphertext_len);

  size_t cmac_pos = 6 + ciphertext_len;
  PW_CO_TRY(sm->BuildCommandCMACWithData(
      ntag424_cmd::kChangeFileSettings, cmd_header, cmd_data,
      pw::ByteSpan(command.data() + cmac_pos, 8)));

  // Lc = 1 (FileNo) + ciphertext_len + 8 (CMACt)
  command[4] = static_cast<std::byte>(1 + ciphertext_len + 8);

  // Le
  size_t total_len = cmac_pos + 8;
  command[total_len] = std::byte{0x00};
  total_len += 1;

  // Response depends on file's current CommMode:
  // Full: [CMACt(8)] [SW(2)] = 10 bytes
  // Plain: [SW(2)] = 2 bytes
  std::array<std::byte, 16> response;
  pw::ConstByteSpan cmd_span(command.data(), total_len);
  PW_CO_TRY_ASSIGN(size_t response_len,
                   co_await DoTransceive(cx, cmd_span, response));

  if (response_len < 2) {
    co_return pw::Status::DataLoss();
  }

  uint8_t sw1 = static_cast<uint8_t>(response[response_len - 2]);
  uint8_t sw2 = static_cast<uint8_t>(response[response_len - 1]);
  if (sw1 != 0x91 || sw2 != 0x00) {
    PW_LOG_WARN("ChangeFileSettings SW=%02X %02X", sw1, sw2);
    co_return InterpretStatusWord(sw1, sw2);
  }

  // Increment CmdCtr for every successful command. The PICC always increments
  // regardless of CommMode; we must stay in sync.
  if (!sm->IncrementCounter()) {
    co_return pw::Status::ResourceExhausted();
  }

  // Verify response CMAC (only for Full/MAC response mode)
  if (response_comm_mode != CommMode::kPlain) {
    if (response_len < 10) {
      co_return pw::Status::DataLoss();
    }

    pw::ConstByteSpan received_cmac(response.data(), 8);
    PW_CO_TRY(sm->VerifyResponseCMAC(0x00, received_cmac));
  }

  co_return pw::OkStatus();
}

// ============================================================================
// EnableRandomUid (SetConfiguration Option 0x00)
// ============================================================================

pw::async2::Coro<pw::Status> Ntag424Tag::EnableRandomUid(
    pw::async2::CoroContext& cx,
    const Ntag424Session& session) {
  PW_CO_TRY(ValidateSession(session));
  auto* sm = secure_messaging();

  // PICCConfig: bit1 = UseRID (random UID)
  constexpr std::array<std::byte, 1> config_data = {
      std::byte{0x02},
  };

  // Encrypt only the config data (always Full mode)
  std::array<std::byte, 16> ciphertext;
  size_t ciphertext_len;
  PW_CO_TRY(sm->EncryptCommandData(config_data, ciphertext, ciphertext_len));

  // Build APDU: 90 5C 00 00 Lc [Option(plaintext)] [Enc(Data)] [CMACt(8)] Le
  // Option byte is CmdHeader (not encrypted), same pattern as ChangeFileSettings
  std::array<std::byte, 32> command;
  command[0] = std::byte{ntag424_cmd::kClaNative};
  command[1] = std::byte{ntag424_cmd::kSetConfiguration};
  command[2] = std::byte{0x00};  // P1
  command[3] = std::byte{0x00};  // P2

  // Option byte (plaintext command header)
  command[5] = std::byte{0x00};  // Option 0x00: PICC configuration

  // Copy ciphertext after Option
  std::copy(ciphertext.begin(), ciphertext.begin() + ciphertext_len,
            command.begin() + 6);

  // Build CMACt over [Option | Ciphertext]
  pw::ConstByteSpan cmd_header(command.data() + 5, 1);  // Option
  pw::ConstByteSpan cmd_data(command.data() + 6, ciphertext_len);
  size_t cmac_pos = 6 + ciphertext_len;
  PW_CO_TRY(sm->BuildCommandCMACWithData(
      ntag424_cmd::kSetConfiguration, cmd_header, cmd_data,
      pw::ByteSpan(command.data() + cmac_pos, 8)));

  // Lc = 1 (Option) + ciphertext_len + 8 (CMACt)
  command[4] = static_cast<std::byte>(1 + ciphertext_len + 8);

  // Le
  size_t total_len = cmac_pos + 8;
  command[total_len] = std::byte{0x00};
  total_len += 1;

  std::array<std::byte, 16> response;
  pw::ConstByteSpan cmd_span(command.data(), total_len);
  PW_CO_TRY_ASSIGN(size_t response_len,
                   co_await DoTransceive(cx, cmd_span, response));

  if (response_len < 2) {
    co_return pw::Status::DataLoss();
  }

  uint8_t sw1 = static_cast<uint8_t>(response[response_len - 2]);
  uint8_t sw2 = static_cast<uint8_t>(response[response_len - 1]);
  if (sw1 != 0x91 || sw2 != 0x00) {
    PW_LOG_WARN("SetConfiguration SW=%02X %02X", sw1, sw2);
    co_return InterpretStatusWord(sw1, sw2);
  }

  if (!sm->IncrementCounter()) {
    co_return pw::Status::ResourceExhausted();
  }

  // Verify response CMAC
  if (response_len >= 10) {
    pw::ConstByteSpan received_cmac(response.data(), 8);
    PW_CO_TRY(sm->VerifyResponseCMAC(0x00, received_cmac));
  }

  co_return pw::OkStatus();
}

// ============================================================================
// ChangeKey
// ============================================================================

pw::async2::Coro<pw::Status> Ntag424Tag::ChangeKey(
    pw::async2::CoroContext& cx,
    const Ntag424Session& session,
    uint8_t key_number,
    pw::ConstByteSpan new_key,
    uint8_t new_key_version,
    pw::ConstByteSpan old_key) {
  PW_CO_TRY(ValidateSession(session));

  // Validate new key size
  if (new_key.size() != 16) {
    co_return pw::Status::InvalidArgument();
  }

  auto* sm = secure_messaging();

  // Copy keys to local arrays for manipulation
  std::array<std::byte, 16> new_key_arr;
  std::copy(new_key.begin(), new_key.end(), new_key_arr.begin());

  std::array<std::byte, 16> old_key_arr{};
  bool has_old_key = !old_key.empty();
  if (has_old_key) {
    if (old_key.size() != 16) {
      co_return pw::Status::InvalidArgument();
    }
    std::copy(old_key.begin(), old_key.end(), old_key_arr.begin());
  }

  // Build plaintext data based on key number:
  // Key 0 (auth key change): NewKey(16) || KeyVer(1)
  // Other keys: (NewKey XOR OldKey)(16) || KeyVer(1) || CRC32NK(NewKey,4)
  // EncryptCommandData handles padding to block boundary.

  std::array<std::byte, 32> plaintext{};
  size_t data_len = 0;

  bool is_auth_key = (key_number == 0);

  if (is_auth_key) {
    // Changing the authentication key: NewKey || KeyVer
    std::copy(new_key_arr.begin(), new_key_arr.end(), plaintext.begin());
    plaintext[16] = std::byte{new_key_version};
    data_len = 17;  // 16 + 1

  } else {
    // Changing a different key: requires old key for XOR
    if (!has_old_key) {
      co_return pw::Status::InvalidArgument();
    }

    // XOR new key with old key
    for (size_t i = 0; i < 16; ++i) {
      plaintext[i] = new_key_arr[i] ^ old_key_arr[i];
    }

    // Key version
    plaintext[16] = std::byte{new_key_version};

    // CRC32NK over new key (NXP uses JAMCRC)
    std::array<std::byte, 4> crc;
    CalculateCRC32NK(new_key_arr, crc);
    plaintext[17] = crc[0];
    plaintext[18] = crc[1];
    plaintext[19] = crc[2];
    plaintext[20] = crc[3];

    data_len = 21;  // 16 + 1 + 4
  }

  // Encrypt the plaintext (EncryptCommandData applies ISO 7816-4 padding)
  std::array<std::byte, 32> ciphertext;
  size_t ciphertext_len;
  PW_CO_TRY(sm->EncryptCommandData(
      pw::ConstByteSpan(plaintext.data(), data_len), ciphertext, ciphertext_len));

  // Build APDU: 90 C4 00 00 Lc [KeyNo] [Ciphertext(32)] [CMACt(8)] 00
  std::array<std::byte, 48> command;
  command[0] = std::byte{ntag424_cmd::kClaNative};
  command[1] = std::byte{ntag424_cmd::kChangeKey};
  command[2] = std::byte{0x00};  // P1
  command[3] = std::byte{0x00};  // P2
  // Lc = 1 (KeyNo) + 32 (ciphertext) + 8 (CMACt) = 41
  command[4] = std::byte{41};

  // Key number
  command[5] = std::byte{key_number};

  // Copy ciphertext
  std::copy(ciphertext.begin(), ciphertext.begin() + 32, command.begin() + 6);

  // Build CMACt over: Cmd || CmdCtr || TI || KeyNo || Ciphertext
  pw::ConstByteSpan cmd_header(command.data() + 5, 1);  // KeyNo
  pw::ConstByteSpan cmd_data(command.data() + 6, 32);   // Ciphertext

  PW_CO_TRY(sm->BuildCommandCMACWithData(
      ntag424_cmd::kChangeKey, cmd_header, cmd_data,
      pw::ByteSpan(command.data() + 38, 8)));

  // Le
  command[46] = std::byte{0x00};
  size_t command_len = 47;

  // Response: CMACt (8) + SW (2) = 10 bytes + margin
  std::array<std::byte, 16> response;
  pw::ConstByteSpan cmd_span(command.data(), command_len);
  auto result = co_await DoTransceive(cx, cmd_span, response);
  if (!result.ok()) {
    // Securely zero sensitive key material before returning
    SecureZero(new_key_arr);
    SecureZero(old_key_arr);
    co_return result.status();
  }

  size_t response_len = result.value();

  // Check status word first (always at end)
  if (response_len < 2) {
    SecureZero(new_key_arr);
    SecureZero(old_key_arr);
    co_return pw::Status::DataLoss();
  }

  uint8_t sw1 = static_cast<uint8_t>(response[response_len - 2]);
  uint8_t sw2 = static_cast<uint8_t>(response[response_len - 1]);

  if (sw1 != 0x91 || sw2 != 0x00) {
    SecureZero(new_key_arr);
    SecureZero(old_key_arr);
    co_return InterpretStatusWord(sw1, sw2);
  }

  if (is_auth_key) {
    // Changing the auth key invalidates the session immediately.
    // The tag returns only [SW(2)] with no response CMAC.
    ClearSession();
  } else {
    // Non-auth key change: verify response CMAC.
    // Response format: [CMACt(8)] [SW(2)] = 10 bytes
    if (response_len < 10) {
      SecureZero(new_key_arr);
      SecureZero(old_key_arr);
      co_return pw::Status::DataLoss();
    }

    // Increment counter BEFORE verifying response MAC.
    // The PICC increments CmdCtr before calculating its response MAC,
    // so we must use CmdCtr+1 when verifying. (AN12196 Section 4.3, Figure 9)
    if (!sm->IncrementCounter()) {
      SecureZero(new_key_arr);
      SecureZero(old_key_arr);
      co_return pw::Status::ResourceExhausted();  // Counter overflow
    }

    // Verify response CMAC (no response data for ChangeKey)
    pw::ConstByteSpan received_cmac(response.data(), 8);
    auto verify_status = sm->VerifyResponseCMAC(0x00, received_cmac);
    if (!verify_status.ok()) {
      SecureZero(new_key_arr);
      SecureZero(old_key_arr);
      co_return verify_status;
    }
  }

  // Securely zero sensitive key material
  SecureZero(new_key_arr);
  SecureZero(old_key_arr);

  co_return pw::OkStatus();
}

// ============================================================================
// GetVersion - Diagnostic command
// ============================================================================

pw::async2::Coro<pw::Status> Ntag424Tag::GetVersion(
    pw::async2::CoroContext& cx) {
  // GetVersion is a 3-part command that retrieves hardware, software, and
  // production info. Each part requires sending an additional frame command.
  // Reference: NTAG 424 DNA datasheet Section 10.4.1

  // Part 1: Send GetVersion command
  std::array<std::byte, 5> cmd1 = {
      std::byte{ntag424_cmd::kClaNative},
      std::byte{ntag424_cmd::kGetVersion},
      std::byte{0x00},  // P1
      std::byte{0x00},  // P2
      std::byte{0x00}   // Le
  };

  std::array<std::byte, 16> response1;
  PW_CO_TRY_ASSIGN(size_t len1, co_await DoTransceive(cx, cmd1, response1));
  if (len1 < 9) {
    PW_LOG_ERROR("GetVersion Part1: Response too short (%u)",
                 static_cast<unsigned>(len1));
    co_return pw::Status::DataLoss();
  }

  uint8_t sw1 = static_cast<uint8_t>(response1[len1 - 2]);
  uint8_t sw2 = static_cast<uint8_t>(response1[len1 - 1]);
  if (sw1 != 0x91 || sw2 != 0xAF) {
    PW_LOG_ERROR("GetVersion Part1: Unexpected SW=%02X %02X", sw1, sw2);
    co_return InterpretStatusWord(sw1, sw2);
  }

  // Log hardware version info
  PW_LOG_INFO("GetVersion: Hardware Info");
  PW_LOG_INFO("  VendorID: %02X", static_cast<int>(response1[0]));
  PW_LOG_INFO("  Type: %02X", static_cast<int>(response1[1]));
  PW_LOG_INFO("  SubType: %02X", static_cast<int>(response1[2]));
  PW_LOG_INFO("  MajorVer: %02X", static_cast<int>(response1[3]));
  PW_LOG_INFO("  MinorVer: %02X", static_cast<int>(response1[4]));
  PW_LOG_INFO("  StorageSize: %02X", static_cast<int>(response1[5]));
  PW_LOG_INFO("  Protocol: %02X", static_cast<int>(response1[6]));

  // Part 2: Send additional frame for software version
  std::array<std::byte, 5> cmd2 = {
      std::byte{ntag424_cmd::kClaNative},
      std::byte{ntag424_cmd::kAdditionalFrame},
      std::byte{0x00},
      std::byte{0x00},
      std::byte{0x00}
  };

  std::array<std::byte, 16> response2;
  PW_CO_TRY_ASSIGN(size_t len2, co_await DoTransceive(cx, cmd2, response2));
  if (len2 < 9) {
    PW_LOG_ERROR("GetVersion Part2: Response too short");
    co_return pw::Status::DataLoss();
  }

  sw1 = static_cast<uint8_t>(response2[len2 - 2]);
  sw2 = static_cast<uint8_t>(response2[len2 - 1]);
  if (sw1 != 0x91 || sw2 != 0xAF) {
    PW_LOG_ERROR("GetVersion Part2: Unexpected SW=%02X %02X", sw1, sw2);
    co_return InterpretStatusWord(sw1, sw2);
  }

  PW_LOG_INFO("GetVersion: Software Info");
  PW_LOG_INFO("  VendorID: %02X", static_cast<int>(response2[0]));
  PW_LOG_INFO("  Type: %02X", static_cast<int>(response2[1]));
  PW_LOG_INFO("  SubType: %02X", static_cast<int>(response2[2]));
  PW_LOG_INFO("  MajorVer: %02X", static_cast<int>(response2[3]));
  PW_LOG_INFO("  MinorVer: %02X", static_cast<int>(response2[4]));
  PW_LOG_INFO("  StorageSize: %02X", static_cast<int>(response2[5]));
  PW_LOG_INFO("  Protocol: %02X", static_cast<int>(response2[6]));

  // Part 3: Send additional frame for production info
  std::array<std::byte, 16> response3;
  PW_CO_TRY_ASSIGN(size_t len3, co_await DoTransceive(cx, cmd2, response3));
  if (len3 < 9) {
    PW_LOG_ERROR("GetVersion Part3: Response too short");
    co_return pw::Status::DataLoss();
  }

  sw1 = static_cast<uint8_t>(response3[len3 - 2]);
  sw2 = static_cast<uint8_t>(response3[len3 - 1]);
  if (sw1 != 0x91 || sw2 != 0x00) {
    PW_LOG_ERROR("GetVersion Part3: Unexpected SW=%02X %02X", sw1, sw2);
    co_return InterpretStatusWord(sw1, sw2);
  }

  PW_LOG_INFO("GetVersion: Production Info");
  PW_LOG_INFO("  UID: %02X %02X %02X %02X %02X %02X %02X",
              static_cast<int>(response3[0]), static_cast<int>(response3[1]),
              static_cast<int>(response3[2]), static_cast<int>(response3[3]),
              static_cast<int>(response3[4]), static_cast<int>(response3[5]),
              static_cast<int>(response3[6]));
  PW_LOG_INFO("  BatchNo: %02X %02X %02X %02X %02X",
              static_cast<int>(response3[7]), static_cast<int>(response3[8]),
              static_cast<int>(response3[9]), static_cast<int>(response3[10]),
              static_cast<int>(response3[11]));
  PW_LOG_INFO("  FabKey/CWProd/YearProd: %02X %02X",
              static_cast<int>(response3[12]), static_cast<int>(response3[13]));

  co_return pw::OkStatus();
}

}  // namespace maco::nfc
