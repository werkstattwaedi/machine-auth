// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file ntag424_secure_messaging.h
/// @brief NTAG424 DNA secure messaging for authenticated operations.
///
/// After AuthenticateEV2First establishes a session with session keys,
/// this class handles:
/// - IV calculation for commands and responses
/// - Truncated CMAC (CMACt) computation
/// - Command/response MAC verification
/// - Full mode encryption/decryption
///
/// Reference: NXP AN12196 "NTAG 424 DNA and NTAG 424 DNA TagTamper
/// features and hints"

#include <array>
#include <cstddef>
#include <cstdint>

#include "pw_bytes/span.h"
#include "pw_status/status.h"

namespace maco::nfc {

/// Secure messaging context for NTAG424 DNA authenticated operations.
///
/// This class manages the secure channel state after authentication:
/// - Session keys (encryption and MAC)
/// - Transaction identifier (TI)
/// - Command counter (CmdCtr)
///
/// Usage:
/// @code
/// // After successful authentication:
/// SecureMessaging sm(ses_auth_enc_key, ses_auth_mac_key, ti);
///
/// // For each command:
/// std::array<std::byte, 8> cmac_t;
/// sm.BuildCommandCMAC(cmd, cmd_header, cmac_t);
/// // Append cmac_t to command
///
/// // After receiving response:
/// if (!sm.VerifyResponseCMAC(response_data, received_cmac_t).ok()) {
///   // Authentication failed
/// }
/// @endcode
class SecureMessaging {
 public:
  static constexpr size_t kKeySize = 16;
  static constexpr size_t kTiSize = 4;
  static constexpr size_t kIvSize = 16;
  static constexpr size_t kCmacSize = 16;
  static constexpr size_t kCmacTruncatedSize = 8;

  /// Construct with session keys and transaction identifier.
  ///
  /// @param ses_auth_enc_key 16-byte session encryption key
  /// @param ses_auth_mac_key 16-byte session MAC key
  /// @param ti 4-byte transaction identifier from authentication
  /// @param initial_cmd_ctr Initial command counter (default 0)
  SecureMessaging(pw::ConstByteSpan ses_auth_enc_key,
                  pw::ConstByteSpan ses_auth_mac_key,
                  pw::ConstByteSpan ti,
                  uint16_t initial_cmd_ctr = 0);

  // --- IV Calculation ---

  /// Calculate command IV.
  /// IVCmd = AES_ECB(SesAuthEncKey, [0xA5][0x5A][TI][CmdCtr_LE][0x00 x 8])
  ///
  /// @param iv_out 16-byte output buffer
  /// @return OkStatus on success
  pw::Status CalculateIVCmd(pw::ByteSpan iv_out);

  /// Calculate response IV.
  /// IVResp = AES_ECB(SesAuthEncKey, [0x5A][0xA5][TI][CmdCtr_LE][0x00 x 8])
  ///
  /// @param iv_out 16-byte output buffer
  /// @return OkStatus on success
  pw::Status CalculateIVResp(pw::ByteSpan iv_out);

  // --- CMAC Operations ---

  /// Compute truncated CMAC (CMACt) from full CMAC.
  /// Takes bytes at odd indices [1,3,5,7,9,11,13,15] to produce 8-byte result.
  ///
  /// @param data Input data to CMAC
  /// @param cmac_t_out 8-byte truncated CMAC output
  /// @return OkStatus on success
  pw::Status CalculateCMACt(pw::ConstByteSpan data, pw::ByteSpan cmac_t_out);

  /// Build command CMAC.
  /// Input: Cmd(1) || CmdCtr(2,LE) || TI(4) || CmdHeader(variable)
  ///
  /// @param cmd Command byte
  /// @param cmd_header Command header bytes (e.g., FileNo, Offset, Length)
  /// @param cmac_t_out 8-byte truncated CMAC output
  /// @return OkStatus on success
  pw::Status BuildCommandCMAC(uint8_t cmd,
                               pw::ConstByteSpan cmd_header,
                               pw::ByteSpan cmac_t_out);

  /// Build command CMAC with data payload.
  /// Input: Cmd(1) || CmdCtr(2,LE) || TI(4) || CmdHeader || Data
  ///
  /// @param cmd Command byte
  /// @param cmd_header Command header bytes
  /// @param data Command data (plaintext or ciphertext depending on mode)
  /// @param cmac_t_out 8-byte truncated CMAC output
  /// @return OkStatus on success
  pw::Status BuildCommandCMACWithData(uint8_t cmd,
                                       pw::ConstByteSpan cmd_header,
                                       pw::ConstByteSpan data,
                                       pw::ByteSpan cmac_t_out);

  /// Verify response CMAC.
  /// Expected: CMAC(SesAuthMACKey, ResponseCode || CmdCtr || TI)
  ///
  /// @param response_code Response status byte (0x00 for success)
  /// @param received_cmac_t 8-byte received truncated CMAC
  /// @return OkStatus if valid, Unauthenticated if mismatch
  pw::Status VerifyResponseCMAC(uint8_t response_code,
                                 pw::ConstByteSpan received_cmac_t);

  /// Verify response CMAC with data.
  /// Expected: CMAC(SesAuthMACKey, ResponseCode || CmdCtr || TI || ResponseData)
  ///
  /// @param response_code Response status byte
  /// @param response_data Response data (plaintext or ciphertext)
  /// @param received_cmac_t 8-byte received truncated CMAC
  /// @return OkStatus if valid, Unauthenticated if mismatch
  pw::Status VerifyResponseCMACWithData(uint8_t response_code,
                                         pw::ConstByteSpan response_data,
                                         pw::ConstByteSpan received_cmac_t);

  // --- Full Mode Encryption/Decryption ---

  /// Encrypt command data for Full communication mode.
  /// Uses AES-CBC with IVCmd, applies padding.
  ///
  /// @param plaintext Data to encrypt
  /// @param ciphertext_out Output buffer (must be >= padded size)
  /// @param ciphertext_len Actual ciphertext length (multiple of 16)
  /// @return OkStatus on success
  pw::Status EncryptCommandData(pw::ConstByteSpan plaintext,
                                 pw::ByteSpan ciphertext_out,
                                 size_t& ciphertext_len);

  /// Decrypt response data from Full communication mode.
  /// Uses AES-CBC with IVResp, strips padding.
  ///
  /// @param ciphertext Encrypted response data
  /// @param plaintext_out Output buffer (same size as ciphertext)
  /// @param plaintext_len Actual plaintext length (after removing padding)
  /// @return OkStatus on success, DataLoss if padding invalid
  pw::Status DecryptResponseData(pw::ConstByteSpan ciphertext,
                                  pw::ByteSpan plaintext_out,
                                  size_t& plaintext_len);

  // --- Counter Management ---

  /// Increment command counter.
  /// Must be called after each successful command.
  ///
  /// @return true on success, false if counter would overflow (0xFFFF)
  bool IncrementCounter();

  /// Get current command counter value.
  uint16_t command_counter() const { return cmd_ctr_; }

  /// Get transaction identifier.
  pw::ConstByteSpan transaction_identifier() const {
    return pw::ConstByteSpan(ti_);
  }

 private:
  /// Calculate IV with given prefix bytes.
  pw::Status CalculateIV(std::byte prefix0, std::byte prefix1,
                          pw::ByteSpan iv_out);

  /// Constant-time comparison for CMAC verification.
  static bool ConstantTimeCompare(pw::ConstByteSpan a, pw::ConstByteSpan b);

  std::array<std::byte, kKeySize> ses_auth_enc_key_;
  std::array<std::byte, kKeySize> ses_auth_mac_key_;
  std::array<std::byte, kTiSize> ti_;
  uint16_t cmd_ctr_;
};

}  // namespace maco::nfc
