// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_secure_messaging.h"

#include <algorithm>
#include <array>

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_crypto.h"
#include "pw_assert/check.h"
#include "pw_status/try.h"

namespace maco::nfc {

namespace {

/// Padding byte for ISO 7816-4 style padding.
constexpr std::byte kPaddingByte{0x80};

/// Apply ISO 7816-4 padding.
/// Adds 0x80 followed by zero bytes to reach a multiple of 16.
///
/// @param data Input data
/// @param padded_out Output buffer (must be >= data.size() + padding needed)
/// @param padded_len Output: padded data length (multiple of 16)
/// @return OkStatus on success
pw::Status ApplyPadding(pw::ConstByteSpan data,
                        pw::ByteSpan padded_out,
                        size_t& padded_len) {
  // Calculate padded size (always add at least 1 byte of padding)
  padded_len = ((data.size() / 16) + 1) * 16;

  if (padded_out.size() < padded_len) {
    return pw::Status::ResourceExhausted();
  }

  // Copy data
  std::copy(data.begin(), data.end(), padded_out.begin());

  // Add padding: 0x80 followed by zeros
  padded_out[data.size()] = kPaddingByte;
  for (size_t i = data.size() + 1; i < padded_len; ++i) {
    padded_out[i] = std::byte{0x00};
  }

  return pw::OkStatus();
}

/// Remove ISO 7816-4 padding.
///
/// @param data Padded data
/// @param unpadded_len Output: actual data length
/// @return OkStatus on success, DataLoss if padding invalid
pw::Status RemovePadding(pw::ConstByteSpan data, size_t& unpadded_len) {
  if (data.empty()) {
    return pw::Status::DataLoss();
  }

  // Find the 0x80 padding byte from the end
  for (size_t i = data.size(); i > 0; --i) {
    if (data[i - 1] == kPaddingByte) {
      unpadded_len = i - 1;
      return pw::OkStatus();
    }
    if (data[i - 1] != std::byte{0x00}) {
      // Found non-zero, non-0x80 byte - invalid padding
      return pw::Status::DataLoss();
    }
  }

  // No padding byte found
  return pw::Status::DataLoss();
}

}  // namespace

SecureMessaging::SecureMessaging(pw::ConstByteSpan ses_auth_enc_key,
                                 pw::ConstByteSpan ses_auth_mac_key,
                                 pw::ConstByteSpan ti,
                                 uint16_t initial_cmd_ctr)
    : cmd_ctr_(initial_cmd_ctr) {
  PW_CHECK_INT_EQ(ses_auth_enc_key.size(), kKeySize);
  PW_CHECK_INT_EQ(ses_auth_mac_key.size(), kKeySize);
  PW_CHECK_INT_EQ(ti.size(), kTiSize);

  std::copy(ses_auth_enc_key.begin(), ses_auth_enc_key.end(),
            ses_auth_enc_key_.begin());
  std::copy(ses_auth_mac_key.begin(), ses_auth_mac_key.end(),
            ses_auth_mac_key_.begin());
  std::copy(ti.begin(), ti.end(), ti_.begin());
}

pw::Status SecureMessaging::CalculateIV(std::byte prefix0,
                                         std::byte prefix1,
                                         pw::ByteSpan iv_out) {
  if (iv_out.size() < kIvSize) {
    return pw::Status::ResourceExhausted();
  }

  // Build IV input: [prefix0][prefix1][TI(4)][CmdCtr(2,LE)][0x00 x 8]
  std::array<std::byte, kIvSize> iv_input{};
  iv_input[0] = prefix0;
  iv_input[1] = prefix1;
  iv_input[2] = ti_[0];
  iv_input[3] = ti_[1];
  iv_input[4] = ti_[2];
  iv_input[5] = ti_[3];
  iv_input[6] = static_cast<std::byte>(cmd_ctr_ & 0xFF);         // CmdCtr LE
  iv_input[7] = static_cast<std::byte>((cmd_ctr_ >> 8) & 0xFF);
  // Bytes 8-15 are already zero from initialization

  // IV = AES_ECB(SesAuthEncKey, iv_input)
  // Use CBC with zero IV for single-block ECB
  constexpr std::array<std::byte, kIvSize> zero_iv{};
  return AesCbcEncrypt(ses_auth_enc_key_, zero_iv, iv_input,
                       iv_out.first(kIvSize));
}

pw::Status SecureMessaging::CalculateIVCmd(pw::ByteSpan iv_out) {
  return CalculateIV(std::byte{0xA5}, std::byte{0x5A}, iv_out);
}

pw::Status SecureMessaging::CalculateIVResp(pw::ByteSpan iv_out) {
  return CalculateIV(std::byte{0x5A}, std::byte{0xA5}, iv_out);
}

pw::Status SecureMessaging::CalculateCMACt(pw::ConstByteSpan data,
                                            pw::ByteSpan cmac_t_out) {
  if (cmac_t_out.size() < kCmacTruncatedSize) {
    return pw::Status::ResourceExhausted();
  }

  // Compute full CMAC
  std::array<std::byte, kCmacSize> full_cmac{};
  PW_TRY(AesCmac(ses_auth_mac_key_, data, full_cmac));

  // Truncate: take bytes at odd indices [1,3,5,7,9,11,13,15]
  cmac_t_out[0] = full_cmac[1];
  cmac_t_out[1] = full_cmac[3];
  cmac_t_out[2] = full_cmac[5];
  cmac_t_out[3] = full_cmac[7];
  cmac_t_out[4] = full_cmac[9];
  cmac_t_out[5] = full_cmac[11];
  cmac_t_out[6] = full_cmac[13];
  cmac_t_out[7] = full_cmac[15];

  return pw::OkStatus();
}

pw::Status SecureMessaging::BuildCommandCMAC(uint8_t cmd,
                                              pw::ConstByteSpan cmd_header,
                                              pw::ByteSpan cmac_t_out) {
  return BuildCommandCMACWithData(cmd, cmd_header, {}, cmac_t_out);
}

pw::Status SecureMessaging::BuildCommandCMACWithData(
    uint8_t cmd,
    pw::ConstByteSpan cmd_header,
    pw::ConstByteSpan data,
    pw::ByteSpan cmac_t_out) {
  // Build CMAC input: Cmd(1) || CmdCtr(2,LE) || TI(4) || CmdHeader || Data
  const size_t input_size = 1 + 2 + 4 + cmd_header.size() + data.size();

  // Fixed buffer sufficient for NTAG424 commands:
  // - Header overhead: 1 (Cmd) + 2 (CmdCtr) + 4 (TI) = 7 bytes
  // - Typical commands: ReadData (7), WriteData (varies), ChangeKey (25)
  // - Max data: ~120 bytes leaves room for all standard operations
  std::array<std::byte, 128> cmac_input{};
  if (input_size > cmac_input.size()) {
    return pw::Status::ResourceExhausted();
  }

  size_t pos = 0;

  // Cmd (1 byte)
  cmac_input[pos++] = static_cast<std::byte>(cmd);

  // CmdCtr (2 bytes, little-endian)
  cmac_input[pos++] = static_cast<std::byte>(cmd_ctr_ & 0xFF);
  cmac_input[pos++] = static_cast<std::byte>((cmd_ctr_ >> 8) & 0xFF);

  // TI (4 bytes)
  cmac_input[pos++] = ti_[0];
  cmac_input[pos++] = ti_[1];
  cmac_input[pos++] = ti_[2];
  cmac_input[pos++] = ti_[3];

  // CmdHeader
  std::copy(cmd_header.begin(), cmd_header.end(), cmac_input.begin() + pos);
  pos += cmd_header.size();

  // Data
  std::copy(data.begin(), data.end(), cmac_input.begin() + pos);
  pos += data.size();

  return CalculateCMACt(pw::ConstByteSpan(cmac_input.data(), pos), cmac_t_out);
}

pw::Status SecureMessaging::VerifyResponseCMAC(
    uint8_t response_code,
    pw::ConstByteSpan received_cmac_t) {
  return VerifyResponseCMACWithData(response_code, {}, received_cmac_t);
}

pw::Status SecureMessaging::VerifyResponseCMACWithData(
    uint8_t response_code,
    pw::ConstByteSpan response_data,
    pw::ConstByteSpan received_cmac_t) {
  if (received_cmac_t.size() != kCmacTruncatedSize) {
    return pw::Status::InvalidArgument();
  }

  // Build CMAC input: ResponseCode(1) || CmdCtr(2,LE) || TI(4) || ResponseData
  const size_t input_size = 1 + 2 + 4 + response_data.size();

  std::array<std::byte, 128> cmac_input{};
  if (input_size > cmac_input.size()) {
    return pw::Status::ResourceExhausted();
  }

  size_t pos = 0;

  // ResponseCode (1 byte)
  cmac_input[pos++] = static_cast<std::byte>(response_code);

  // CmdCtr (2 bytes, little-endian)
  cmac_input[pos++] = static_cast<std::byte>(cmd_ctr_ & 0xFF);
  cmac_input[pos++] = static_cast<std::byte>((cmd_ctr_ >> 8) & 0xFF);

  // TI (4 bytes)
  cmac_input[pos++] = ti_[0];
  cmac_input[pos++] = ti_[1];
  cmac_input[pos++] = ti_[2];
  cmac_input[pos++] = ti_[3];

  // ResponseData
  std::copy(response_data.begin(), response_data.end(),
            cmac_input.begin() + pos);
  pos += response_data.size();

  // Compute expected CMACt
  std::array<std::byte, kCmacTruncatedSize> expected_cmac_t{};
  PW_TRY(CalculateCMACt(pw::ConstByteSpan(cmac_input.data(), pos),
                        expected_cmac_t));

  // Constant-time comparison
  if (!ConstantTimeCompare(expected_cmac_t, received_cmac_t)) {
    return pw::Status::Unauthenticated();
  }

  return pw::OkStatus();
}

pw::Status SecureMessaging::EncryptCommandData(pw::ConstByteSpan plaintext,
                                                pw::ByteSpan ciphertext_out,
                                                size_t& ciphertext_len) {
  // Apply padding
  std::array<std::byte, 128> padded;
  size_t padded_len;
  PW_TRY(ApplyPadding(plaintext, padded, padded_len));

  if (ciphertext_out.size() < padded_len) {
    return pw::Status::ResourceExhausted();
  }

  // Calculate IVCmd
  std::array<std::byte, kIvSize> iv_cmd{};
  PW_TRY(CalculateIVCmd(iv_cmd));

  // Encrypt with AES-CBC
  PW_TRY(AesCbcEncrypt(ses_auth_enc_key_, iv_cmd,
                       pw::ConstByteSpan(padded.data(), padded_len),
                       ciphertext_out.first(padded_len)));

  ciphertext_len = padded_len;
  return pw::OkStatus();
}

pw::Status SecureMessaging::DecryptResponseData(pw::ConstByteSpan ciphertext,
                                                 pw::ByteSpan plaintext_out,
                                                 size_t& plaintext_len) {
  if (ciphertext.empty() || (ciphertext.size() % 16) != 0) {
    return pw::Status::InvalidArgument();
  }

  if (plaintext_out.size() < ciphertext.size()) {
    return pw::Status::ResourceExhausted();
  }

  // Calculate IVResp
  std::array<std::byte, kIvSize> iv_resp{};
  PW_TRY(CalculateIVResp(iv_resp));

  // Decrypt with AES-CBC
  PW_TRY(AesCbcDecrypt(ses_auth_enc_key_, iv_resp, ciphertext,
                       plaintext_out.first(ciphertext.size())));

  // Remove padding
  return RemovePadding(plaintext_out.first(ciphertext.size()), plaintext_len);
}

bool SecureMessaging::IncrementCounter() {
  if (cmd_ctr_ == 0xFFFF) {
    return false;  // Overflow - session exhausted
  }
  cmd_ctr_++;
  return true;
}

bool SecureMessaging::ConstantTimeCompare(pw::ConstByteSpan a,
                                           pw::ConstByteSpan b) {
  if (a.size() != b.size()) {
    return false;
  }

  volatile uint8_t diff = 0;
  for (size_t i = 0; i < a.size(); ++i) {
    diff |= static_cast<uint8_t>(a[i]) ^ static_cast<uint8_t>(b[i]);
  }

  return diff == 0;
}

}  // namespace maco::nfc
