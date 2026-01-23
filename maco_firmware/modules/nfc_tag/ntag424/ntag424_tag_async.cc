// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag_async.h"

#include <algorithm>
#include <cstring>

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
}

void Ntag424Tag::SetSecureMessaging(pw::ConstByteSpan ses_auth_enc_key,
                                    pw::ConstByteSpan ses_auth_mac_key,
                                    pw::ConstByteSpan ti) {
  secure_messaging_.emplace(ses_auth_enc_key, ses_auth_mac_key, ti, 0);
}

Ntag424Session Ntag424Tag::CreateSession(uint8_t key_number) {
  authenticated_key_number_ = key_number;
  return Ntag424Session(key_number);
}

SelectApplicationFuture Ntag424Tag::SelectApplication() {
  return SelectApplicationFuture(select_provider_, *this);
}

AuthenticateFuture Ntag424Tag::Authenticate(
    Ntag424KeyProvider& key_provider,
    pw::random::RandomGenerator& random_generator) {
  return AuthenticateFuture(auth_provider_, *this, key_provider,
                            random_generator);
}

GetCardUidFuture Ntag424Tag::GetCardUid(pw::ByteSpan uid_buffer) {
  return GetCardUidFuture(get_uid_provider_, *this, uid_buffer);
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
// SelectApplicationFuture
// ============================================================================

SelectApplicationFuture::SelectApplicationFuture(
    pw::async2::SingleFutureProvider<SelectApplicationFuture>& provider,
    Ntag424Tag& tag)
    : Base(provider), tag_(&tag), state_(State::kSending) {
  // Build ISOSelectFile command:
  // CLA=0x00, INS=0xA4, P1=0x04, P2=0x0C
  // Data: DF name = D2 76 00 00 85 01 01
  command_ = {std::byte{ntag424_cmd::kClaIso},
              std::byte{ntag424_cmd::kIsoSelectFile},
              std::byte{0x04},  // P1: Select by DF name
              std::byte{0x0C},  // P2: No response data
              std::byte{0x07},  // Lc: 7 bytes
              std::byte{0xD2}, std::byte{0x76}, std::byte{0x00}, std::byte{0x00},
              std::byte{0x85}, std::byte{0x01}, std::byte{0x01},
              std::byte{0x00}};  // Le
}

SelectApplicationFuture::SelectApplicationFuture(
    SelectApplicationFuture&& other) noexcept
    : Base(Base::ConstructedState::kMovedFrom),
      tag_(other.tag_),
      state_(other.state_),
      command_(other.command_),
      response_(other.response_),
      transceive_future_(std::move(other.transceive_future_)) {
  Base::MoveFrom(other);
  other.tag_ = nullptr;
}

SelectApplicationFuture& SelectApplicationFuture::operator=(
    SelectApplicationFuture&& other) noexcept {
  Base::MoveFrom(other);
  tag_ = other.tag_;
  state_ = other.state_;
  command_ = other.command_;
  response_ = other.response_;
  transceive_future_ = std::move(other.transceive_future_);
  other.tag_ = nullptr;
  return *this;
}

pw::async2::Poll<pw::Status> SelectApplicationFuture::DoPend(
    pw::async2::Context& cx) {
  using pw::async2::Pending;
  using pw::async2::Ready;

  if (tag_ == nullptr) {
    return Ready(pw::Status::FailedPrecondition());
  }

  switch (state_) {
    case State::kSending:
      transceive_future_.emplace(
          tag_->Transceive(command_, response_, Ntag424Tag::kDefaultTimeout));
      state_ = State::kWaiting;
      [[fallthrough]];

    case State::kWaiting: {
      auto poll = transceive_future_->Pend(cx);
      if (poll.IsPending()) {
        return Pending();
      }

      if (!poll.value().ok()) {
        return Ready(poll.value().status());
      }

      size_t len = poll.value().value();
      if (len < 2) {
        return Ready(pw::Status::DataLoss());
      }

      // Check status word (SW1=0x90, SW2=0x00 for success)
      uint8_t sw1 = static_cast<uint8_t>(response_[len - 2]);
      uint8_t sw2 = static_cast<uint8_t>(response_[len - 1]);
      if (sw1 != 0x90 || sw2 != 0x00) {
        return Ready(Ntag424Tag::InterpretStatusWord(sw1, sw2));
      }

      return Ready(pw::OkStatus());
    }
  }

  return Ready(pw::Status::Internal());
}

// ============================================================================
// AuthenticateFuture
// ============================================================================

AuthenticateFuture::AuthenticateFuture(
    pw::async2::SingleFutureProvider<AuthenticateFuture>& provider,
    Ntag424Tag& tag,
    Ntag424KeyProvider& key_provider,
    pw::random::RandomGenerator& random_generator)
    : Base(provider),
      tag_(&tag),
      key_provider_(&key_provider),
      random_generator_(&random_generator),
      state_(State::kSendingPart1) {
  // Clear any existing session
  tag_->ClearSession();

  // Build Part 1 command: 90 71 00 00 02 [KeyNo] [LenCap=0x00] 00
  part1_command_ = {std::byte{ntag424_cmd::kClaNative},
                    std::byte{ntag424_cmd::kAuthenticateEv2First},
                    std::byte{0x00},  // P1
                    std::byte{0x00},  // P2
                    std::byte{0x02},  // Lc: 2 bytes
                    std::byte{key_provider.key_number()},
                    std::byte{0x00},  // LenCap (no PCDcap2)
                    std::byte{0x00}};  // Le

  // Generate RndA
  random_generator_->Get(rnd_a_);
}

AuthenticateFuture::AuthenticateFuture(AuthenticateFuture&& other) noexcept
    : Base(Base::ConstructedState::kMovedFrom),
      tag_(other.tag_),
      key_provider_(other.key_provider_),
      random_generator_(other.random_generator_),
      state_(other.state_),
      part1_command_(other.part1_command_),
      part1_response_(other.part1_response_),
      part2_command_(other.part2_command_),
      part2_response_(other.part2_response_),
      rnd_a_(other.rnd_a_),
      auth_result_(other.auth_result_),
      transceive_future_(std::move(other.transceive_future_)) {
  Base::MoveFrom(other);
  other.tag_ = nullptr;
}

AuthenticateFuture& AuthenticateFuture::operator=(
    AuthenticateFuture&& other) noexcept {
  Base::MoveFrom(other);
  tag_ = other.tag_;
  key_provider_ = other.key_provider_;
  random_generator_ = other.random_generator_;
  state_ = other.state_;
  part1_command_ = other.part1_command_;
  part1_response_ = other.part1_response_;
  part2_command_ = other.part2_command_;
  part2_response_ = other.part2_response_;
  rnd_a_ = other.rnd_a_;
  auth_result_ = other.auth_result_;
  transceive_future_ = std::move(other.transceive_future_);
  other.tag_ = nullptr;
  return *this;
}

pw::async2::Poll<pw::Result<Ntag424Session>> AuthenticateFuture::DoPend(
    pw::async2::Context& cx) {
  using pw::async2::Pending;
  using pw::async2::Ready;

  if (tag_ == nullptr) {
    return Ready(pw::Status::FailedPrecondition());
  }

  switch (state_) {
    case State::kSendingPart1:
      transceive_future_.emplace(tag_->Transceive(
          part1_command_, part1_response_, Ntag424Tag::kDefaultTimeout));
      state_ = State::kWaitingPart1;
      [[fallthrough]];

    case State::kWaitingPart1: {
      auto poll = transceive_future_->Pend(cx);
      if (poll.IsPending()) {
        return Pending();
      }

      if (!poll.value().ok()) {
        state_ = State::kFailed;
        return Ready(poll.value().status());
      }

      size_t len = poll.value().value();
      if (len < 18) {  // 16 encrypted RndB + 2 SW
        state_ = State::kFailed;
        return Ready(pw::Status::DataLoss());
      }

      uint8_t sw1 = static_cast<uint8_t>(part1_response_[len - 2]);
      uint8_t sw2 = static_cast<uint8_t>(part1_response_[len - 1]);
      if (sw1 != 0x91 || sw2 != 0xAF) {
        state_ = State::kFailed;
        return Ready(Ntag424Tag::InterpretStatusWord(sw1, sw2));
      }

      // Process Part 1 and prepare Part 2
      pw::Status process_status = ProcessPart1Response();
      if (!process_status.ok()) {
        state_ = State::kFailed;
        return Ready(process_status);
      }

      state_ = State::kSendingPart2;
      [[fallthrough]];
    }

    case State::kSendingPart2:
      transceive_future_.emplace(tag_->Transceive(
          part2_command_, part2_response_, Ntag424Tag::kDefaultTimeout));
      state_ = State::kWaitingPart2;
      [[fallthrough]];

    case State::kWaitingPart2: {
      auto poll = transceive_future_->Pend(cx);
      if (poll.IsPending()) {
        return Pending();
      }

      if (!poll.value().ok()) {
        state_ = State::kFailed;
        return Ready(poll.value().status());
      }

      auto result = ProcessPart2Response();
      if (result.ok()) {
        state_ = State::kCompleted;
      } else {
        state_ = State::kFailed;
      }
      return Ready(std::move(result));
    }

    case State::kCompleted:
    case State::kFailed:
      return Ready(pw::Status::FailedPrecondition());
  }

  return Ready(pw::Status::Internal());
}

pw::Status AuthenticateFuture::ProcessPart1Response() {
  // Extract encrypted RndB (first 16 bytes)
  pw::ConstByteSpan encrypted_rnd_b(part1_response_.data(), 16);

  // Compute authentication response via key provider
  auto compute_result =
      key_provider_->ComputeAuthResponse(rnd_a_, encrypted_rnd_b);
  if (!compute_result.ok()) {
    return compute_result.status();
  }
  auth_result_ = compute_result.value();

  // Build Part 2 command: 90 AF 00 00 20 [32 bytes encrypted data] 00
  part2_command_[0] = std::byte{ntag424_cmd::kClaNative};
  part2_command_[1] = std::byte{ntag424_cmd::kAdditionalFrame};
  part2_command_[2] = std::byte{0x00};  // P1
  part2_command_[3] = std::byte{0x00};  // P2
  part2_command_[4] = std::byte{0x20};  // Lc: 32 bytes
  std::copy(auth_result_.part2_response.begin(),
            auth_result_.part2_response.end(), part2_command_.begin() + 5);
  part2_command_[37] = std::byte{0x00};  // Le

  return pw::OkStatus();
}

pw::Result<Ntag424Session> AuthenticateFuture::ProcessPart2Response() {
  // Find actual length by checking for 91 00 status word
  size_t len = 0;
  for (size_t i = 2; i < part2_response_.size(); ++i) {
    if (part2_response_[i - 2] == std::byte{0x91} &&
        (part2_response_[i - 1] == std::byte{0x00} ||
         part2_response_[i - 1] == std::byte{0xAF})) {
      len = i;
      break;
    }
  }

  // The response should be at least 34 bytes (32 encrypted + SW 91 00)
  if (len < 34) {
    return pw::Status::DataLoss();
  }

  uint8_t sw1 = static_cast<uint8_t>(part2_response_[len - 2]);
  uint8_t sw2 = static_cast<uint8_t>(part2_response_[len - 1]);
  if (sw1 != 0x91 || sw2 != 0x00) {
    return Ntag424Tag::InterpretStatusWord(sw1, sw2);
  }

  // Decrypt the response to get TI || RndA' || PDcap2 || PCDcap2
  pw::ConstByteSpan encrypted_part2(part2_response_.data(), 32);
  std::array<std::byte, 32> decrypted_part2;
  constexpr std::array<std::byte, 16> zero_iv = {};
  auto decrypt_status = AesCbcDecrypt(auth_result_.ses_auth_enc_key, zero_iv,
                                      encrypted_part2, decrypted_part2);
  if (!decrypt_status.ok()) {
    return decrypt_status;
  }

  // Extract TI (first 4 bytes)
  std::array<std::byte, 4> ti;
  std::copy(decrypted_part2.begin(), decrypted_part2.begin() + 4, ti.begin());

  // Verify RndA' (bytes 4-19) matches RndA rotated left
  pw::ConstByteSpan rnd_a_prime(decrypted_part2.data() + 4, 16);
  if (!VerifyRndAPrime(rnd_a_, rnd_a_prime)) {
    // Mutual authentication failed - tag did not prove knowledge of key
    return pw::Status::Unauthenticated();
  }

  // Authentication successful - store session state
  tag_->SetSecureMessaging(auth_result_.ses_auth_enc_key,
                           auth_result_.ses_auth_mac_key, ti);

  return tag_->CreateSession(key_provider_->key_number());
}

// ============================================================================
// GetCardUidFuture
// ============================================================================

GetCardUidFuture::GetCardUidFuture(
    pw::async2::SingleFutureProvider<GetCardUidFuture>& provider,
    Ntag424Tag& tag,
    pw::ByteSpan uid_buffer)
    : Base(provider),
      tag_(&tag),
      uid_buffer_(uid_buffer),
      state_(State::kSending) {
  if (!tag_->is_authenticated()) {
    state_ = State::kFailed;
    return;
  }

  auto* sm = tag_->secure_messaging();
  if (sm == nullptr) {
    state_ = State::kFailed;
    return;
  }

  // Build GetCardUID command with CMAC
  // GetCardUID: 90 51 00 00 08 [CMACt(8)] 00
  command_[0] = std::byte{ntag424_cmd::kClaNative};
  command_[1] = std::byte{ntag424_cmd::kGetCardUid};
  command_[2] = std::byte{0x00};  // P1
  command_[3] = std::byte{0x00};  // P2
  command_[4] = std::byte{0x08};  // Lc: 8 bytes (CMACt)

  // Build CMACt for the command (no command header for GetCardUID)
  pw::ByteSpan cmac_out(command_.data() + 5, 8);
  auto cmac_status =
      sm->BuildCommandCMAC(ntag424_cmd::kGetCardUid, {}, cmac_out);
  if (!cmac_status.ok()) {
    state_ = State::kFailed;
    return;
  }

  command_[13] = std::byte{0x00};  // Le
}

GetCardUidFuture::GetCardUidFuture(GetCardUidFuture&& other) noexcept
    : Base(Base::ConstructedState::kMovedFrom),
      tag_(other.tag_),
      uid_buffer_(other.uid_buffer_),
      state_(other.state_),
      command_(other.command_),
      response_(other.response_),
      transceive_future_(std::move(other.transceive_future_)) {
  Base::MoveFrom(other);
  other.tag_ = nullptr;
}

GetCardUidFuture& GetCardUidFuture::operator=(
    GetCardUidFuture&& other) noexcept {
  Base::MoveFrom(other);
  tag_ = other.tag_;
  uid_buffer_ = other.uid_buffer_;
  state_ = other.state_;
  command_ = other.command_;
  response_ = other.response_;
  transceive_future_ = std::move(other.transceive_future_);
  other.tag_ = nullptr;
  return *this;
}

pw::async2::Poll<pw::Result<size_t>> GetCardUidFuture::DoPend(
    pw::async2::Context& cx) {
  using pw::async2::Pending;
  using pw::async2::Ready;

  if (tag_ == nullptr) {
    return Ready(pw::Status::FailedPrecondition());
  }

  switch (state_) {
    case State::kFailed:
      return Ready(pw::Status::Unauthenticated());

    case State::kSending:
      transceive_future_.emplace(
          tag_->Transceive(command_, response_, Ntag424Tag::kDefaultTimeout));
      state_ = State::kWaiting;
      [[fallthrough]];

    case State::kWaiting: {
      auto poll = transceive_future_->Pend(cx);
      if (poll.IsPending()) {
        return Pending();
      }

      if (!poll.value().ok()) {
        state_ = State::kFailed;
        return Ready(poll.value().status());
      }

      auto result = ProcessResponse(poll.value().value());
      if (result.ok()) {
        state_ = State::kCompleted;
      } else {
        state_ = State::kFailed;
      }
      return Ready(std::move(result));
    }

    case State::kCompleted:
      return Ready(pw::Status::FailedPrecondition());
  }

  return Ready(pw::Status::Internal());
}

pw::Result<size_t> GetCardUidFuture::ProcessResponse(size_t response_len) {
  // Response format: [EncryptedUID(16)] [CMACt(8)] [SW(2)]
  // Minimum: 16 + 8 + 2 = 26 bytes
  if (response_len < 26) {
    return pw::Status::DataLoss();
  }

  // Check status word
  uint8_t sw1 = static_cast<uint8_t>(response_[response_len - 2]);
  uint8_t sw2 = static_cast<uint8_t>(response_[response_len - 1]);
  if (sw1 != 0x91 || sw2 != 0x00) {
    return Ntag424Tag::InterpretStatusWord(sw1, sw2);
  }

  auto* sm = tag_->secure_messaging();
  if (sm == nullptr) {
    return pw::Status::FailedPrecondition();
  }

  // Extract encrypted data (16 bytes) and CMACt (8 bytes)
  pw::ConstByteSpan encrypted_data(response_.data(), 16);
  pw::ConstByteSpan received_cmac(response_.data() + 16, 8);

  // Decrypt the response
  std::array<std::byte, 16> decrypted;
  size_t plaintext_len;
  auto decrypt_status =
      sm->DecryptResponseData(encrypted_data, decrypted, plaintext_len);
  if (!decrypt_status.ok()) {
    return decrypt_status;
  }

  // Verify response CMAC
  // Note: For Full mode, CMAC is computed over decrypted data
  auto verify_status = sm->VerifyResponseCMACWithData(
      0x00,  // Response code for success
      pw::ConstByteSpan(decrypted.data(), plaintext_len), received_cmac);
  if (!verify_status.ok()) {
    return verify_status;
  }

  // Increment command counter after successful operation
  if (!sm->IncrementCounter()) {
    return pw::Status::ResourceExhausted();  // Counter overflow
  }

  // Copy UID to output buffer (7 bytes)
  if (uid_buffer_.size() < plaintext_len) {
    return pw::Status::ResourceExhausted();
  }

  std::copy(decrypted.begin(), decrypted.begin() + plaintext_len,
            uid_buffer_.begin());

  return plaintext_len;
}

}  // namespace maco::nfc
