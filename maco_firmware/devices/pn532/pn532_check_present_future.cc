// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/devices/pn532/pn532_check_present_future.h"

#include "maco_firmware/devices/pn532/pn532_constants.h"
#include "maco_firmware/devices/pn532/pn532_nfc_reader.h"

namespace maco::nfc {

using namespace pn532;

Pn532CheckPresentFuture::Pn532CheckPresentFuture(
    pw::async2::SingleFutureProvider<Pn532CheckPresentFuture>& provider,
    Pn532NfcReader& reader,
    pw::chrono::SystemClock::time_point deadline)
    : Base(provider),
      reader_(&reader),
      params_{std::byte{kDiagnoseAttentionRequest}},
      call_future_(reader.uart(),
                   Pn532Command{kCmdDiagnose, params_},
                   deadline) {}

Pn532CheckPresentFuture::Pn532CheckPresentFuture(
    Pn532CheckPresentFuture&& other) noexcept
    : Base(Base::ConstructedState::kMovedFrom),
      reader_(other.reader_),
      params_(other.params_),
      call_future_(std::move(other.call_future_)) {
  Base::MoveFrom(other);
  other.reader_ = nullptr;
}

Pn532CheckPresentFuture& Pn532CheckPresentFuture::operator=(
    Pn532CheckPresentFuture&& other) noexcept {
  Base::MoveFrom(other);
  reader_ = other.reader_;
  params_ = other.params_;
  call_future_ = std::move(other.call_future_);
  other.reader_ = nullptr;
  return *this;
}

pw::async2::Poll<pw::Result<bool>> Pn532CheckPresentFuture::DoPend(
    pw::async2::Context& cx) {
  using pw::async2::Pending;
  using pw::async2::Ready;

  if (reader_ == nullptr) {
    return Ready(pw::Status::FailedPrecondition());
  }

  auto poll = call_future_.Poll(cx);
  if (poll.IsPending()) {
    return Pending();
  }

  if (!poll.value().ok()) {
    return Ready(poll.value().status());
  }

  return Ready(ParseResponse(poll.value().value()));
}

pw::Result<bool> Pn532CheckPresentFuture::ParseResponse(
    pw::ConstByteSpan payload) {
  // Diagnose response: [Status]
  if (payload.size() != 1) {
    return pw::Status::DataLoss();
  }

  uint8_t status = static_cast<uint8_t>(payload[0]);
  if (status == 0x00) {
    return pw::Result<bool>(true);  // Tag present
  } else if (status == 0x01) {
    return pw::Result<bool>(false);  // Tag removed
  } else {
    // Error (0x27 = not ISO14443-4 capable, etc.)
    return pw::Status::Internal();
  }
}

}  // namespace maco::nfc
