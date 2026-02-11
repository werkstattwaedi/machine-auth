// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag_mock.h"

#include <algorithm>
#include <array>
#include <cstring>

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_crypto.h"
#include "pw_log/log.h"

namespace maco::nfc {

namespace {

constexpr size_t kBlockSize = 16;
constexpr std::array<std::byte, kBlockSize> kZeroIv = {};

// NTAG424 APDU constants
constexpr uint8_t kClaNative = 0x90;
constexpr uint8_t kClaIso = 0x00;
constexpr uint8_t kInsSelectFile = 0xA4;
constexpr uint8_t kInsAuthEv2First = 0x71;
constexpr uint8_t kInsAdditionalFrame = 0xAF;
constexpr uint8_t kInsGetCardUid = 0x51;

// NTAG424 DF name for SelectApplication
constexpr std::array<std::byte, 7> kNtag424DfName = {
    std::byte{0xD2}, std::byte{0x76}, std::byte{0x00}, std::byte{0x00},
    std::byte{0x85}, std::byte{0x01}, std::byte{0x01}};

bool IsSelectApp(pw::ConstByteSpan cmd) {
  // 00 A4 04 0C 07 D2760000850101 00
  if (cmd.size() < 12) return false;
  if (static_cast<uint8_t>(cmd[0]) != kClaIso) return false;
  if (static_cast<uint8_t>(cmd[1]) != kInsSelectFile) return false;
  if (static_cast<uint8_t>(cmd[2]) != 0x04) return false;  // P1
  if (static_cast<uint8_t>(cmd[3]) != 0x0C) return false;  // P2
  if (static_cast<uint8_t>(cmd[4]) != 0x07) return false;  // Lc
  return std::equal(kNtag424DfName.begin(), kNtag424DfName.end(),
                    cmd.begin() + 5);
}

bool IsAuthPart1(pw::ConstByteSpan cmd) {
  // 90 71 00 00 02 [KeyNo] [LenCap] 00
  if (cmd.size() < 8) return false;
  if (static_cast<uint8_t>(cmd[0]) != kClaNative) return false;
  if (static_cast<uint8_t>(cmd[1]) != kInsAuthEv2First) return false;
  return true;
}

bool IsAdditionalFrame(pw::ConstByteSpan cmd) {
  // 90 AF 00 00 20 [...32 bytes...] 00
  if (cmd.size() < 5) return false;
  if (static_cast<uint8_t>(cmd[0]) != kClaNative) return false;
  if (static_cast<uint8_t>(cmd[1]) != kInsAdditionalFrame) return false;
  return true;
}

bool IsGetCardUid(pw::ConstByteSpan cmd) {
  // 90 51 00 00 08 [CMACt(8)] 00
  if (cmd.size() < 5) return false;
  if (static_cast<uint8_t>(cmd[0]) != kClaNative) return false;
  if (static_cast<uint8_t>(cmd[1]) != kInsGetCardUid) return false;
  return true;
}

}  // namespace

Ntag424TagMock::Ntag424TagMock(pw::ConstByteSpan uid,
                                uint8_t sak,
                                const Config& config,
                                pw::random::RandomGenerator& rng)
    : MockTag(uid, sak, true), config_(config), rng_(rng) {}

void Ntag424TagMock::OnEnterField() {
  state_ = State::kIdle;
  secure_messaging_.reset();
  SecureZero(ses_auth_enc_key_);
}

void Ntag424TagMock::OnLeaveField() {
  state_ = State::kIdle;
  secure_messaging_.reset();
  SecureZero(auth_rnd_b_);
  SecureZero(ses_auth_enc_key_);
}

pw::Result<size_t> Ntag424TagMock::HandleTransceive(
    pw::ConstByteSpan command, pw::ByteSpan response_buffer) {
  if (IsSelectApp(command)) {
    return HandleSelectApp(command, response_buffer);
  }

  if (IsAuthPart1(command) && state_ == State::kSelected) {
    return HandleAuthPart1(command, response_buffer);
  }

  if (IsAdditionalFrame(command) && state_ == State::kAuthPart1Sent) {
    return HandleAuthPart2(command, response_buffer);
  }

  if (IsGetCardUid(command) && state_ == State::kAuthenticated) {
    return HandleGetCardUid(command, response_buffer);
  }

  // Unrecognized command or wrong state
  if (response_buffer.size() < 2) {
    return pw::Status::ResourceExhausted();
  }
  // 91 1C = Illegal command code
  return WriteStatus(response_buffer, 0x91, 0x1C);
}

// ============================================================================
// SelectApplication
// ============================================================================

pw::Result<size_t> Ntag424TagMock::HandleSelectApp(
    pw::ConstByteSpan /*command*/, pw::ByteSpan response) {
  if (response.size() < 2) return pw::Status::ResourceExhausted();

  // SelectApp always succeeds and resets to SELECTED
  secure_messaging_.reset();
  SecureZero(ses_auth_enc_key_);
  state_ = State::kSelected;

  return WriteStatus(response, 0x90, 0x00);
}

// ============================================================================
// AuthenticateEV2First — Part 1 (tag generates RndB challenge)
// ============================================================================

pw::Result<size_t> Ntag424TagMock::HandleAuthPart1(
    pw::ConstByteSpan command, pw::ByteSpan response) {
  // Command: 90 71 00 00 02 [KeyNo] [LenCap] 00
  if (command.size() < 8) {
    return WriteStatus(response, 0x91, 0x7E);  // Length error
  }

  uint8_t key_number = static_cast<uint8_t>(command[5]);
  if (key_number > 4) {
    return WriteStatus(response, 0x91, 0x40);  // No such key
  }

  // Need 16 (encrypted RndB) + 2 (status)
  if (response.size() < 18) return pw::Status::ResourceExhausted();

  // Generate RndB
  rng_.Get(auth_rnd_b_);
  auth_key_number_ = key_number;

  // Encrypt RndB with the key: AES-CBC(key, IV=zeros, RndB)
  auto status = AesCbcEncrypt(config_.keys[key_number], kZeroIv,
                                auth_rnd_b_, response.first(kBlockSize));
  if (!status.ok()) return status;

  // Status: 91 AF (more data expected)
  response[16] = std::byte{0x91};
  response[17] = std::byte{0xAF};

  state_ = State::kAuthPart1Sent;
  return size_t{18};
}

// ============================================================================
// AuthenticateEV2First — Part 2 (tag verifies RndB', builds Part 3)
// ============================================================================

pw::Result<size_t> Ntag424TagMock::HandleAuthPart2(
    pw::ConstByteSpan command, pw::ByteSpan response) {
  // Command: 90 AF 00 00 20 [32 bytes encrypted Part2] 00
  if (command.size() < 38) {
    state_ = State::kSelected;
    return WriteStatus(response, 0x91, 0x7E);  // Length error
  }

  // Need 32 (encrypted Part3) + 2 (status)
  if (response.size() < 34) return pw::Status::ResourceExhausted();

  const auto& auth_key = config_.keys[auth_key_number_];

  // Decrypt Part 2: AES-CBC(key, IV=zeros, encrypted_part2) → RndA || RndB'
  pw::ConstByteSpan encrypted_part2(command.data() + 5, 32);
  std::array<std::byte, 32> decrypted_part2;
  auto status =
      AesCbcDecrypt(auth_key, kZeroIv, encrypted_part2, decrypted_part2);
  if (!status.ok()) {
    state_ = State::kSelected;
    return WriteStatus(response, 0x91, 0xAE);  // Auth error
  }

  // Extract RndA and RndB'
  std::array<std::byte, 16> received_rnd_a;
  std::copy(decrypted_part2.begin(), decrypted_part2.begin() + 16,
            received_rnd_a.begin());
  pw::ConstByteSpan received_rnd_b_prime(decrypted_part2.data() + 16, 16);

  // Verify RndB' == RotateLeft1(stored RndB)
  std::array<std::byte, 16> expected_rnd_b_prime;
  RotateLeft1(auth_rnd_b_, expected_rnd_b_prime);

  if (!std::equal(expected_rnd_b_prime.begin(), expected_rnd_b_prime.end(),
                  received_rnd_b_prime.begin())) {
    state_ = State::kSelected;
    return WriteStatus(response, 0x91, 0xAE);  // Auth error
  }

  // Build Part 3: TI(4) || RndA'(16) || PDcap2(6) || PCDcap2(6) = 32 bytes
  std::array<std::byte, 32> part3{};

  // TI = 4 random bytes
  std::array<std::byte, 4> ti;
  rng_.Get(ti);
  std::copy(ti.begin(), ti.end(), part3.begin());

  // RndA' = RotateLeft1(RndA)
  std::array<std::byte, 16> rnd_a_prime;
  RotateLeft1(received_rnd_a, rnd_a_prime);
  std::copy(rnd_a_prime.begin(), rnd_a_prime.end(), part3.begin() + 4);

  // PDcap2 (6 bytes) and PCDcap2 (6 bytes) — zeros for mock

  // Encrypt Part 3: AES-CBC(key, IV=zeros, Part3)
  status = AesCbcEncrypt(auth_key, kZeroIv, part3, response.first(32));
  if (!status.ok()) {
    state_ = State::kSelected;
    return WriteStatus(response, 0x91, 0xAE);
  }

  // Derive session keys
  std::array<std::byte, 16> ses_auth_enc_key;
  std::array<std::byte, 16> ses_auth_mac_key;
  status = DeriveSessionKeys(auth_key, received_rnd_a, auth_rnd_b_,
                              ses_auth_enc_key, ses_auth_mac_key);
  if (!status.ok()) {
    state_ = State::kSelected;
    return WriteStatus(response, 0x91, 0xAE);
  }

  // Store session state
  ses_auth_enc_key_ = ses_auth_enc_key;
  secure_messaging_.emplace(ses_auth_enc_key, ses_auth_mac_key, ti, 0);

  // Clean up auth context
  SecureZero(auth_rnd_b_);

  // Status: 91 00 (success)
  response[32] = std::byte{0x91};
  response[33] = std::byte{0x00};

  state_ = State::kAuthenticated;
  return size_t{34};
}

// ============================================================================
// GetCardUid — returns encrypted real UID
// ============================================================================

pw::Result<size_t> Ntag424TagMock::HandleGetCardUid(
    pw::ConstByteSpan command, pw::ByteSpan response) {
  // Command: 90 51 00 00 08 [CMACt(8)] 00
  if (command.size() < 14) {
    return WriteStatus(response, 0x91, 0x7E);
  }

  // Need 16 (encrypted UID) + 8 (CMACt) + 2 (status)
  if (response.size() < 26) return pw::Status::ResourceExhausted();

  auto& sm = *secure_messaging_;

  // Verify incoming command CMAC
  // The reader computed: BuildCommandCMAC(0x51, {}, cmac_out) at current CmdCtr
  std::array<std::byte, 8> expected_cmac;
  auto status = sm.BuildCommandCMAC(kInsGetCardUid, {}, expected_cmac);
  if (!status.ok()) {
    return WriteStatus(response, 0x91, 0xAE);
  }

  pw::ConstByteSpan received_cmac(command.data() + 5, 8);
  if (!std::equal(expected_cmac.begin(), expected_cmac.end(),
                  received_cmac.begin())) {
    return WriteStatus(response, 0x91, 0xAE);
  }

  // Increment CmdCtr (before computing response IV/CMAC)
  if (!sm.IncrementCounter()) {
    return WriteStatus(response, 0x91, 0xCA);  // Command aborted
  }

  // Pad real UID with ISO 7816-4: UID(7) || 0x80 || 0x00*8 = 16 bytes
  std::array<std::byte, 16> padded_uid{};
  std::copy(config_.real_uid.begin(), config_.real_uid.end(),
            padded_uid.begin());
  padded_uid[7] = std::byte{0x80};
  // Bytes 8-15 already zero from initialization

  // Calculate response IV: AES-ECB(SesAuthEncKey, [5A A5 TI CmdCtr_LE zeros])
  std::array<std::byte, 16> iv_resp;
  status = sm.CalculateIVResp(iv_resp);
  if (!status.ok()) {
    return WriteStatus(response, 0x91, 0xCA);
  }

  // Encrypt padded UID: AES-CBC(SesAuthEncKey, IVResp, padded_uid)
  status = AesCbcEncrypt(ses_auth_enc_key_, iv_resp, padded_uid,
                          response.first(16));
  if (!status.ok()) {
    return WriteStatus(response, 0x91, 0xCA);
  }

  // Calculate response CMAC over: 0x00 || CmdCtr(2,LE) || TI(4) || ciphertext
  // Build the input manually and use CalculateCMACt
  pw::ConstByteSpan ti = sm.transaction_identifier();
  uint16_t cmd_ctr = sm.command_counter();

  std::array<std::byte, 23> cmac_input{};  // 1 + 2 + 4 + 16
  cmac_input[0] = std::byte{0x00};  // Response code (success)
  cmac_input[1] = static_cast<std::byte>(cmd_ctr & 0xFF);
  cmac_input[2] = static_cast<std::byte>((cmd_ctr >> 8) & 0xFF);
  std::copy(ti.begin(), ti.end(), cmac_input.begin() + 3);
  std::copy(response.begin(), response.begin() + 16, cmac_input.begin() + 7);

  status = sm.CalculateCMACt(cmac_input, response.subspan(16, 8));
  if (!status.ok()) {
    return WriteStatus(response, 0x91, 0xCA);
  }

  // Status: 91 00
  response[24] = std::byte{0x91};
  response[25] = std::byte{0x00};

  return size_t{26};
}

// ============================================================================
// Helpers
// ============================================================================

size_t Ntag424TagMock::WriteStatus(pw::ByteSpan buf, uint8_t sw1,
                                    uint8_t sw2) {
  buf[0] = std::byte{sw1};
  buf[1] = std::byte{sw2};
  return 2;
}

}  // namespace maco::nfc
