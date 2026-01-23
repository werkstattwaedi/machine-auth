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

ReadDataFuture Ntag424Tag::ReadData(uint8_t file_number,
                                    uint32_t offset,
                                    uint32_t length,
                                    pw::ByteSpan data_buffer,
                                    CommMode comm_mode) {
  return ReadDataFuture(read_data_provider_, *this, file_number, offset, length,
                        data_buffer, comm_mode);
}

WriteDataFuture Ntag424Tag::WriteData(uint8_t file_number,
                                      uint32_t offset,
                                      pw::ConstByteSpan data,
                                      CommMode comm_mode) {
  return WriteDataFuture(write_data_provider_, *this, file_number, offset, data,
                         comm_mode);
}

ChangeKeyFuture Ntag424Tag::ChangeKey(uint8_t key_number,
                                      pw::ConstByteSpan new_key,
                                      uint8_t new_key_version,
                                      pw::ConstByteSpan old_key) {
  return ChangeKeyFuture(change_key_provider_, *this, key_number, new_key,
                         new_key_version, old_key);
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

AuthenticateFuture::~AuthenticateFuture() {
  // Securely zero sensitive key material
  SecureZero(rnd_a_);
  SecureZero(auth_result_.ses_auth_enc_key);
  SecureZero(auth_result_.ses_auth_mac_key);
  SecureZero(auth_result_.part2_response);
}

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

  // Verify response CMAC first (over ciphertext per AN12196 Section 4.4)
  auto verify_status =
      sm->VerifyResponseCMACWithData(0x00, encrypted_data, received_cmac);
  if (!verify_status.ok()) {
    return verify_status;
  }

  // Decrypt the response after MAC verification
  std::array<std::byte, 16> decrypted;
  size_t plaintext_len;
  auto decrypt_status =
      sm->DecryptResponseData(encrypted_data, decrypted, plaintext_len);
  if (!decrypt_status.ok()) {
    return decrypt_status;
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

// ============================================================================
// ReadDataFuture
// ============================================================================

ReadDataFuture::ReadDataFuture(
    pw::async2::SingleFutureProvider<ReadDataFuture>& provider,
    Ntag424Tag& tag,
    uint8_t file_number,
    uint32_t offset,
    uint32_t length,
    pw::ByteSpan data_buffer,
    CommMode comm_mode)
    : Base(provider),
      tag_(&tag),
      data_buffer_(data_buffer),
      file_number_(file_number),
      offset_(offset),
      length_(length),
      comm_mode_(comm_mode),
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

  // Build ReadData command: 90 AD 00 00 Lc [FileNo] [Offset(3)] [Length(3)]
  // [CMACt(8)] 00
  command_[0] = std::byte{ntag424_cmd::kClaNative};
  command_[1] = std::byte{ntag424_cmd::kReadData};
  command_[2] = std::byte{0x00};  // P1
  command_[3] = std::byte{0x00};  // P2
  command_[4] = std::byte{15};    // Lc: 1 + 3 + 3 + 8 = 15

  // File number
  command_[5] = std::byte{file_number};

  // Offset (3 bytes, little-endian)
  command_[6] = static_cast<std::byte>(offset & 0xFF);
  command_[7] = static_cast<std::byte>((offset >> 8) & 0xFF);
  command_[8] = static_cast<std::byte>((offset >> 16) & 0xFF);

  // Length (3 bytes, little-endian)
  command_[9] = static_cast<std::byte>(length & 0xFF);
  command_[10] = static_cast<std::byte>((length >> 8) & 0xFF);
  command_[11] = static_cast<std::byte>((length >> 16) & 0xFF);

  // Build CMACt for the command header
  pw::ConstByteSpan cmd_header(command_.data() + 5, 7);  // FileNo + Offset + Len
  pw::ByteSpan cmac_out(command_.data() + 12, 8);
  auto cmac_status =
      sm->BuildCommandCMAC(ntag424_cmd::kReadData, cmd_header, cmac_out);
  if (!cmac_status.ok()) {
    state_ = State::kFailed;
    return;
  }

  command_[20] = std::byte{0x00};  // Le
}

ReadDataFuture::ReadDataFuture(ReadDataFuture&& other) noexcept
    : Base(Base::ConstructedState::kMovedFrom),
      tag_(other.tag_),
      data_buffer_(other.data_buffer_),
      file_number_(other.file_number_),
      offset_(other.offset_),
      length_(other.length_),
      comm_mode_(other.comm_mode_),
      state_(other.state_),
      total_bytes_read_(other.total_bytes_read_),
      command_(other.command_),
      response_(other.response_),
      transceive_future_(std::move(other.transceive_future_)) {
  Base::MoveFrom(other);
  other.tag_ = nullptr;
}

ReadDataFuture& ReadDataFuture::operator=(ReadDataFuture&& other) noexcept {
  Base::MoveFrom(other);
  tag_ = other.tag_;
  data_buffer_ = other.data_buffer_;
  file_number_ = other.file_number_;
  offset_ = other.offset_;
  length_ = other.length_;
  comm_mode_ = other.comm_mode_;
  state_ = other.state_;
  total_bytes_read_ = other.total_bytes_read_;
  command_ = other.command_;
  response_ = other.response_;
  transceive_future_ = std::move(other.transceive_future_);
  other.tag_ = nullptr;
  return *this;
}

pw::async2::Poll<pw::Result<size_t>> ReadDataFuture::DoPend(
    pw::async2::Context& cx) {
  using pw::async2::Pending;
  using pw::async2::Ready;

  if (tag_ == nullptr) {
    return Ready(pw::Status::FailedPrecondition());
  }

  switch (state_) {
    case State::kFailed:
      return Ready(pw::Status::Unauthenticated());

    case State::kSending: {
      // Use full command including Le byte
      pw::ConstByteSpan cmd_span(command_.data(), 21);
      transceive_future_.emplace(
          tag_->Transceive(cmd_span, response_, Ntag424Tag::kDefaultTimeout));
      state_ = State::kWaiting;
      [[fallthrough]];
    }

    case State::kWaiting:
    case State::kChaining: {
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

pw::Result<size_t> ReadDataFuture::ProcessResponse(size_t response_len) {
  // Minimum response: encrypted data (16) + CMACt (8) + SW (2) = 26 bytes
  // For MAC mode: data + CMACt (8) + SW (2)
  if (response_len < 10) {
    return pw::Status::DataLoss();
  }

  // Check status word
  uint8_t sw1 = static_cast<uint8_t>(response_[response_len - 2]);
  uint8_t sw2 = static_cast<uint8_t>(response_[response_len - 1]);

  // 91 AF means more data available (chaining)
  // For simplicity, we don't support chaining in this implementation
  if (sw1 == 0x91 && sw2 == 0xAF) {
    // TODO: Implement chaining for large reads
    return pw::Status::Unimplemented();
  }

  if (sw1 != 0x91 || sw2 != 0x00) {
    return Ntag424Tag::InterpretStatusWord(sw1, sw2);
  }

  auto* sm = tag_->secure_messaging();
  if (sm == nullptr) {
    return pw::Status::FailedPrecondition();
  }

  // Data length = response_len - 2 (SW) - 8 (CMACt)
  size_t data_with_cmac_len = response_len - 2;
  if (data_with_cmac_len < 8) {
    return pw::Status::DataLoss();
  }
  size_t encrypted_data_len = data_with_cmac_len - 8;

  if (comm_mode_ == CommMode::kFull && encrypted_data_len > 0) {
    // Full mode: Verify CMAC over ciphertext first, then decrypt
    pw::ConstByteSpan encrypted_data(response_.data(), encrypted_data_len);
    pw::ConstByteSpan received_cmac(response_.data() + encrypted_data_len, 8);

    // Verify response CMAC over ciphertext (per AN12196 Section 4.4)
    auto verify_status =
        sm->VerifyResponseCMACWithData(0x00, encrypted_data, received_cmac);
    if (!verify_status.ok()) {
      return verify_status;
    }

    // Decrypt after MAC verification
    std::array<std::byte, 64> decrypted;
    if (encrypted_data_len > decrypted.size()) {
      return pw::Status::ResourceExhausted();
    }

    size_t plaintext_len;
    auto decrypt_status = sm->DecryptResponseData(
        encrypted_data, pw::ByteSpan(decrypted.data(), encrypted_data_len),
        plaintext_len);
    if (!decrypt_status.ok()) {
      return decrypt_status;
    }

    // Copy to output buffer
    if (data_buffer_.size() < plaintext_len) {
      return pw::Status::ResourceExhausted();
    }
    std::copy(decrypted.begin(), decrypted.begin() + plaintext_len,
              data_buffer_.begin());
    total_bytes_read_ = plaintext_len;

  } else if (comm_mode_ == CommMode::kMac) {
    // MAC mode: Data is plain, just verify CMAC
    pw::ConstByteSpan plain_data(response_.data(), encrypted_data_len);
    pw::ConstByteSpan received_cmac(response_.data() + encrypted_data_len, 8);

    auto verify_status =
        sm->VerifyResponseCMACWithData(0x00, plain_data, received_cmac);
    if (!verify_status.ok()) {
      return verify_status;
    }

    if (data_buffer_.size() < encrypted_data_len) {
      return pw::Status::ResourceExhausted();
    }
    std::copy(plain_data.begin(), plain_data.end(), data_buffer_.begin());
    total_bytes_read_ = encrypted_data_len;

  } else {
    // Plain mode: No encryption, no CMAC verification
    // Response is just data + SW
    size_t data_len = response_len - 2;
    if (data_buffer_.size() < data_len) {
      return pw::Status::ResourceExhausted();
    }
    std::copy(response_.begin(), response_.begin() + data_len,
              data_buffer_.begin());
    total_bytes_read_ = data_len;
  }

  // Increment command counter after successful operation
  if (comm_mode_ != CommMode::kPlain) {
    if (!sm->IncrementCounter()) {
      return pw::Status::ResourceExhausted();  // Counter overflow
    }
  }

  return total_bytes_read_;
}

// ============================================================================
// WriteDataFuture
// ============================================================================

WriteDataFuture::WriteDataFuture(
    pw::async2::SingleFutureProvider<WriteDataFuture>& provider,
    Ntag424Tag& tag,
    uint8_t file_number,
    uint32_t offset,
    pw::ConstByteSpan data,
    CommMode comm_mode)
    : Base(provider),
      tag_(&tag),
      data_(data),
      file_number_(file_number),
      offset_(offset),
      comm_mode_(comm_mode),
      state_(State::kSending) {
  if (!tag_->is_authenticated()) {
    state_ = State::kFailed;
    return;
  }

  // Build the command
  auto build_status = BuildCommand();
  if (!build_status.ok()) {
    state_ = State::kFailed;
    return;
  }
}

WriteDataFuture::WriteDataFuture(WriteDataFuture&& other) noexcept
    : Base(Base::ConstructedState::kMovedFrom),
      tag_(other.tag_),
      data_(other.data_),
      file_number_(other.file_number_),
      offset_(other.offset_),
      comm_mode_(other.comm_mode_),
      state_(other.state_),
      command_(other.command_),
      command_len_(other.command_len_),
      response_(other.response_),
      transceive_future_(std::move(other.transceive_future_)) {
  Base::MoveFrom(other);
  other.tag_ = nullptr;
}

WriteDataFuture& WriteDataFuture::operator=(WriteDataFuture&& other) noexcept {
  Base::MoveFrom(other);
  tag_ = other.tag_;
  data_ = other.data_;
  file_number_ = other.file_number_;
  offset_ = other.offset_;
  comm_mode_ = other.comm_mode_;
  state_ = other.state_;
  command_ = other.command_;
  command_len_ = other.command_len_;
  response_ = other.response_;
  transceive_future_ = std::move(other.transceive_future_);
  other.tag_ = nullptr;
  return *this;
}

pw::Status WriteDataFuture::BuildCommand() {
  auto* sm = tag_->secure_messaging();
  if (sm == nullptr) {
    return pw::Status::FailedPrecondition();
  }

  // WriteData command: 90 8D 00 00 Lc [FileNo] [Offset(3)] [Length(3)] [Data]
  // [CMACt(8)] 00

  // Header position offsets
  constexpr size_t kApduHeaderSize = 5;  // CLA INS P1 P2 Lc
  constexpr size_t kCmdHeaderStart = kApduHeaderSize;
  constexpr size_t kCmdHeaderSize = 7;  // FileNo + Offset(3) + Length(3)
  constexpr size_t kDataStart = kCmdHeaderStart + kCmdHeaderSize;

  // Build APDU header
  command_[0] = std::byte{ntag424_cmd::kClaNative};
  command_[1] = std::byte{ntag424_cmd::kWriteData};
  command_[2] = std::byte{0x00};  // P1
  command_[3] = std::byte{0x00};  // P2
  // Lc will be filled in after we know the data size

  // Command header: FileNo + Offset(3) + Length(3)
  command_[kCmdHeaderStart] = std::byte{file_number_};
  command_[kCmdHeaderStart + 1] = static_cast<std::byte>(offset_ & 0xFF);
  command_[kCmdHeaderStart + 2] = static_cast<std::byte>((offset_ >> 8) & 0xFF);
  command_[kCmdHeaderStart + 3] =
      static_cast<std::byte>((offset_ >> 16) & 0xFF);

  uint32_t length = static_cast<uint32_t>(data_.size());
  command_[kCmdHeaderStart + 4] = static_cast<std::byte>(length & 0xFF);
  command_[kCmdHeaderStart + 5] = static_cast<std::byte>((length >> 8) & 0xFF);
  command_[kCmdHeaderStart + 6] =
      static_cast<std::byte>((length >> 16) & 0xFF);

  size_t data_in_cmd_len = 0;

  if (comm_mode_ == CommMode::kFull) {
    // Encrypt the data
    // Padded size = ((data.size() + 15) / 16) * 16
    size_t padded_size = ((data_.size() + 15) / 16) * 16;
    if (padded_size > 64) {
      // Data too large for single frame
      return pw::Status::OutOfRange();
    }

    size_t ciphertext_len;
    auto encrypt_status = sm->EncryptCommandData(
        data_, pw::ByteSpan(command_.data() + kDataStart, padded_size),
        ciphertext_len);
    if (!encrypt_status.ok()) {
      return encrypt_status;
    }
    data_in_cmd_len = ciphertext_len;

  } else if (comm_mode_ == CommMode::kMac) {
    // MAC mode: Data is plain
    if (data_.size() > 48) {
      return pw::Status::OutOfRange();
    }
    std::copy(data_.begin(), data_.end(), command_.begin() + kDataStart);
    data_in_cmd_len = data_.size();

  } else {
    // Plain mode: Data is plain, no MAC
    if (data_.size() > 48) {
      return pw::Status::OutOfRange();
    }
    std::copy(data_.begin(), data_.end(), command_.begin() + kDataStart);
    data_in_cmd_len = data_.size();
  }

  // Build CMACt (for Full and MAC modes)
  size_t cmac_pos = kDataStart + data_in_cmd_len;
  if (comm_mode_ != CommMode::kPlain) {
    pw::ConstByteSpan cmd_header(command_.data() + kCmdHeaderStart,
                                  kCmdHeaderSize);
    pw::ConstByteSpan cmd_data(command_.data() + kDataStart, data_in_cmd_len);

    auto cmac_status = sm->BuildCommandCMACWithData(
        ntag424_cmd::kWriteData, cmd_header, cmd_data,
        pw::ByteSpan(command_.data() + cmac_pos, 8));
    if (!cmac_status.ok()) {
      return cmac_status;
    }
    cmac_pos += 8;
  }

  // Set Lc (everything after APDU header except Le)
  size_t lc = kCmdHeaderSize + data_in_cmd_len;
  if (comm_mode_ != CommMode::kPlain) {
    lc += 8;  // CMACt
  }
  command_[4] = static_cast<std::byte>(lc);

  // Le
  command_[cmac_pos] = std::byte{0x00};
  command_len_ = cmac_pos + 1;

  return pw::OkStatus();
}

pw::async2::Poll<pw::Status> WriteDataFuture::DoPend(pw::async2::Context& cx) {
  using pw::async2::Pending;
  using pw::async2::Ready;

  if (tag_ == nullptr) {
    return Ready(pw::Status::FailedPrecondition());
  }

  switch (state_) {
    case State::kFailed:
      return Ready(pw::Status::Unauthenticated());

    case State::kSending: {
      pw::ConstByteSpan cmd_span(command_.data(), command_len_);
      transceive_future_.emplace(
          tag_->Transceive(cmd_span, response_, Ntag424Tag::kDefaultTimeout));
      state_ = State::kWaiting;
      [[fallthrough]];
    }

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
      return Ready(result);
    }

    case State::kCompleted:
      return Ready(pw::Status::FailedPrecondition());
  }

  return Ready(pw::Status::Internal());
}

pw::Status WriteDataFuture::ProcessResponse(size_t response_len) {
  // Response format for Full/MAC mode: [CMACt(8)] [SW(2)] = 10 bytes
  // For Plain mode: [SW(2)] = 2 bytes
  if (response_len < 2) {
    return pw::Status::DataLoss();
  }

  // Check status word
  uint8_t sw1 = static_cast<uint8_t>(response_[response_len - 2]);
  uint8_t sw2 = static_cast<uint8_t>(response_[response_len - 1]);

  if (sw1 != 0x91 || sw2 != 0x00) {
    return Ntag424Tag::InterpretStatusWord(sw1, sw2);
  }

  auto* sm = tag_->secure_messaging();
  if (sm == nullptr && comm_mode_ != CommMode::kPlain) {
    return pw::Status::FailedPrecondition();
  }

  // Verify response CMAC for Full and MAC modes
  if (comm_mode_ != CommMode::kPlain) {
    if (response_len < 10) {
      return pw::Status::DataLoss();
    }

    pw::ConstByteSpan received_cmac(response_.data(), 8);

    // For write, response has no data, just verify the empty response CMAC
    auto verify_status = sm->VerifyResponseCMAC(0x00, received_cmac);
    if (!verify_status.ok()) {
      return verify_status;
    }

    // Increment command counter after successful operation
    if (!sm->IncrementCounter()) {
      return pw::Status::ResourceExhausted();  // Counter overflow
    }
  }

  return pw::OkStatus();
}

// ============================================================================
// ChangeKeyFuture
// ============================================================================

ChangeKeyFuture::~ChangeKeyFuture() {
  // Securely zero sensitive key material
  SecureZero(new_key_);
  SecureZero(old_key_);
}

ChangeKeyFuture::ChangeKeyFuture(
    pw::async2::SingleFutureProvider<ChangeKeyFuture>& provider,
    Ntag424Tag& tag,
    uint8_t key_number,
    pw::ConstByteSpan new_key,
    uint8_t new_key_version,
    pw::ConstByteSpan old_key)
    : Base(provider),
      tag_(&tag),
      key_number_(key_number),
      new_key_version_(new_key_version),
      state_(State::kSending) {
  // Validate authentication
  if (!tag_->is_authenticated()) {
    state_ = State::kFailed;
    return;
  }

  // Validate new key size
  if (new_key.size() != 16) {
    state_ = State::kFailed;
    return;
  }
  std::copy(new_key.begin(), new_key.end(), new_key_.begin());

  // Store old key if provided (required for changing non-auth keys)
  if (!old_key.empty()) {
    if (old_key.size() != 16) {
      state_ = State::kFailed;
      return;
    }
    std::copy(old_key.begin(), old_key.end(), old_key_.begin());
    has_old_key_ = true;
  }

  // Build the command
  auto build_status = BuildCommand();
  if (!build_status.ok()) {
    state_ = State::kFailed;
    return;
  }
}

ChangeKeyFuture::ChangeKeyFuture(ChangeKeyFuture&& other) noexcept
    : Base(Base::ConstructedState::kMovedFrom),
      tag_(other.tag_),
      key_number_(other.key_number_),
      new_key_(other.new_key_),
      new_key_version_(other.new_key_version_),
      old_key_(other.old_key_),
      has_old_key_(other.has_old_key_),
      state_(other.state_),
      command_(other.command_),
      command_len_(other.command_len_),
      response_(other.response_),
      transceive_future_(std::move(other.transceive_future_)) {
  Base::MoveFrom(other);
  other.tag_ = nullptr;
}

ChangeKeyFuture& ChangeKeyFuture::operator=(ChangeKeyFuture&& other) noexcept {
  Base::MoveFrom(other);
  tag_ = other.tag_;
  key_number_ = other.key_number_;
  new_key_ = other.new_key_;
  new_key_version_ = other.new_key_version_;
  old_key_ = other.old_key_;
  has_old_key_ = other.has_old_key_;
  state_ = other.state_;
  command_ = other.command_;
  command_len_ = other.command_len_;
  response_ = other.response_;
  transceive_future_ = std::move(other.transceive_future_);
  other.tag_ = nullptr;
  return *this;
}

pw::Status ChangeKeyFuture::BuildCommand() {
  auto* sm = tag_->secure_messaging();
  if (sm == nullptr) {
    return pw::Status::FailedPrecondition();
  }

  // Build plaintext data based on key number:
  // Key 0 (auth key change): NewKey(16) || KeyVer(1)
  // Other keys: (NewKey XOR OldKey)(16) || KeyVer(1) || CRC32NK(NewKey,4)
  // EncryptCommandData handles padding to block boundary.

  std::array<std::byte, 32> plaintext{};
  size_t data_len = 0;

  bool is_auth_key = (key_number_ == tag_->authenticated_key_number_);

  if (is_auth_key) {
    // Changing the authentication key: NewKey || KeyVer
    std::copy(new_key_.begin(), new_key_.end(), plaintext.begin());
    plaintext[16] = std::byte{new_key_version_};
    data_len = 17;  // 16 + 1

  } else {
    // Changing a different key: requires old key for XOR
    if (!has_old_key_) {
      return pw::Status::InvalidArgument();
    }

    // XOR new key with old key
    for (size_t i = 0; i < 16; ++i) {
      plaintext[i] = new_key_[i] ^ old_key_[i];
    }

    // Key version
    plaintext[16] = std::byte{new_key_version_};

    // CRC32NK over new key (NXP uses JAMCRC)
    std::array<std::byte, 4> crc;
    CalculateCRC32NK(new_key_, crc);
    plaintext[17] = crc[0];
    plaintext[18] = crc[1];
    plaintext[19] = crc[2];
    plaintext[20] = crc[3];

    data_len = 21;  // 16 + 1 + 4
  }

  // Encrypt the plaintext (EncryptCommandData applies ISO 7816-4 padding)
  std::array<std::byte, 32> ciphertext;
  size_t ciphertext_len;
  auto encrypt_status = sm->EncryptCommandData(
      pw::ConstByteSpan(plaintext.data(), data_len), ciphertext, ciphertext_len);
  if (!encrypt_status.ok()) {
    return encrypt_status;
  }

  // Build APDU: 90 C4 00 00 Lc [KeyNo] [Ciphertext(32)] [CMACt(8)] 00
  command_[0] = std::byte{ntag424_cmd::kClaNative};
  command_[1] = std::byte{ntag424_cmd::kChangeKey};
  command_[2] = std::byte{0x00};  // P1
  command_[3] = std::byte{0x00};  // P2
  // Lc = 1 (KeyNo) + 32 (ciphertext) + 8 (CMACt) = 41
  command_[4] = std::byte{41};

  // Key number
  command_[5] = std::byte{key_number_};

  // Copy ciphertext
  std::copy(ciphertext.begin(), ciphertext.begin() + 32, command_.begin() + 6);

  // Build CMACt over: Cmd || CmdCtr || TI || KeyNo || Ciphertext
  pw::ConstByteSpan cmd_header(command_.data() + 5, 1);  // KeyNo
  pw::ConstByteSpan cmd_data(command_.data() + 6, 32);   // Ciphertext

  auto cmac_status = sm->BuildCommandCMACWithData(
      ntag424_cmd::kChangeKey, cmd_header, cmd_data,
      pw::ByteSpan(command_.data() + 38, 8));
  if (!cmac_status.ok()) {
    return cmac_status;
  }

  // Le
  command_[46] = std::byte{0x00};
  command_len_ = 47;

  return pw::OkStatus();
}

pw::async2::Poll<pw::Status> ChangeKeyFuture::DoPend(pw::async2::Context& cx) {
  using pw::async2::Pending;
  using pw::async2::Ready;

  if (tag_ == nullptr) {
    return Ready(pw::Status::FailedPrecondition());
  }

  switch (state_) {
    case State::kFailed:
      return Ready(pw::Status::Unauthenticated());

    case State::kSending: {
      pw::ConstByteSpan cmd_span(command_.data(), command_len_);
      transceive_future_.emplace(
          tag_->Transceive(cmd_span, response_, Ntag424Tag::kDefaultTimeout));
      state_ = State::kWaiting;
      [[fallthrough]];
    }

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
      return Ready(result);
    }

    case State::kCompleted:
      return Ready(pw::Status::FailedPrecondition());
  }

  return Ready(pw::Status::Internal());
}

pw::Status ChangeKeyFuture::ProcessResponse(size_t response_len) {
  // Response format: [CMACt(8)] [SW(2)] = 10 bytes
  if (response_len < 10) {
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

  // Verify response CMAC (no response data for ChangeKey)
  pw::ConstByteSpan received_cmac(response_.data(), 8);
  auto verify_status = sm->VerifyResponseCMAC(0x00, received_cmac);
  if (!verify_status.ok()) {
    return verify_status;
  }

  // Increment command counter after successful operation
  if (!sm->IncrementCounter()) {
    return pw::Status::ResourceExhausted();  // Counter overflow
  }

  // Important: After changing the authentication key, the session is
  // invalidated. The caller should re-authenticate with the new key.
  // For non-auth key changes, the session remains valid.
  if (key_number_ == tag_->authenticated_key_number_) {
    tag_->ClearSession();
  }

  return pw::OkStatus();
}

}  // namespace maco::nfc
