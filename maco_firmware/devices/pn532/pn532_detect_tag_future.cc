// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/devices/pn532/pn532_detect_tag_future.h"

#include <cstring>

#include "maco_firmware/devices/pn532/pn532_constants.h"
#include "maco_firmware/devices/pn532/pn532_driver.h"
#include "pw_log/log.h"

namespace maco::nfc {

using namespace pn532;

Pn532DetectTagFuture::Pn532DetectTagFuture(
    pw::async2::SingleFutureProvider<Pn532DetectTagFuture>& provider,
    Pn532Driver& driver,
    pw::chrono::SystemClock::time_point deadline)
    : Base(provider),
      driver_(&driver),
      params_{std::byte{0x01}, std::byte{0x00}},  // MaxTg=1, BrTy=106kbps Type A
      call_future_(driver.uart(),
                   Pn532Command{kCmdInListPassiveTarget, params_},
                   deadline) {}

Pn532DetectTagFuture::Pn532DetectTagFuture(
    Pn532DetectTagFuture&& other) noexcept
    : Base(Base::ConstructedState::kMovedFrom),
      driver_(other.driver_),
      params_(other.params_),
      call_future_(std::move(other.call_future_)) {
  Base::MoveFrom(other);
  other.driver_ = nullptr;
}

Pn532DetectTagFuture& Pn532DetectTagFuture::operator=(
    Pn532DetectTagFuture&& other) noexcept {
  Base::MoveFrom(other);
  driver_ = other.driver_;
  params_ = other.params_;
  call_future_ = std::move(other.call_future_);
  other.driver_ = nullptr;
  return *this;
}

pw::async2::Poll<pw::Result<TagInfo>> Pn532DetectTagFuture::DoPend(
    pw::async2::Context& cx) {
  using pw::async2::Pending;
  using pw::async2::Ready;

  if (driver_ == nullptr) {
    return Ready(pw::Status::FailedPrecondition());
  }

  auto poll = call_future_.Poll(cx);
  if (poll.IsPending()) {
    return Pending();
  }

  // Timeout waiting for response = no card found
  if (poll.value().status().IsDeadlineExceeded()) {
    (void)driver_->uart().Write(kAckFrame);  // Abort pending command
    driver_->DrainReceiveBuffer();
    return Ready(pw::Status::NotFound());
  }

  if (!poll.value().ok()) {
    return Ready(poll.value().status());
  }

  // Parse the response payload
  return Ready(ParseResponse(poll.value().value()));
}

pw::Result<TagInfo> Pn532DetectTagFuture::ParseResponse(
    pw::ConstByteSpan payload) {
  // InListPassiveTarget response: [NbTg][Tg][SENS_RES(2)][SEL_RES][NFCIDLength][NFCID...]
  if (payload.empty()) {
    return pw::Status::NotFound();
  }

  uint8_t num_targets = static_cast<uint8_t>(payload[0]);
  if (num_targets == 0) {
    return pw::Status::NotFound();
  }

  // Need at least: NbTg + Tg + SENS_RES(2) + SEL_RES + NFCIDLength = 6 bytes
  if (payload.size() < 6) {
    return pw::Status::DataLoss();
  }

  TagInfo info = {};
  info.target_number = static_cast<uint8_t>(payload[1]);
  info.sak = static_cast<uint8_t>(payload[4]);
  info.uid_length = static_cast<uint8_t>(payload[5]);

  if (info.uid_length > info.uid.size()) {
    return pw::Status::OutOfRange();
  }

  if (payload.size() < 6 + info.uid_length) {
    return pw::Status::DataLoss();
  }

  std::memcpy(info.uid.data(), &payload[6], info.uid_length);
  info.supports_iso14443_4 = (info.sak & 0x20) != 0;

  driver_->set_current_target_number(info.target_number);

  PW_LOG_INFO("Tag detected: UID=%d bytes, SAK=%02x, ISO14443-4=%s",
              static_cast<int>(info.uid_length), info.sak,
              info.supports_iso14443_4 ? "yes" : "no");

  return info;
}

}  // namespace maco::nfc
