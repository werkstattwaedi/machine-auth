// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/devices/pn532/pn532_transceive_future.h"

#include <cstring>

#include "maco_firmware/devices/pn532/pn532_nfc_reader.h"

#define PW_LOG_MODULE_NAME "pn532"

#include "pw_log/log.h"

namespace maco::nfc {

using namespace pn532;

Pn532TransceiveFuture::Pn532TransceiveFuture(
    pw::async2::SingleFutureProvider<Pn532TransceiveFuture>& provider,
    Pn532NfcReader& reader,
    pw::ConstByteSpan command,
    pw::ByteSpan response_buffer,
    pw::chrono::SystemClock::time_point deadline)
    : Base(provider),
      reader_(&reader),
      response_buffer_(response_buffer),
      params_len_(0),
      call_future_(reader.uart(),
                   Pn532Command{kCmdInDataExchange, {}},  // Placeholder, updated below
                   deadline) {
  // Build params: [Tg][DataOut...]
  if (command.size() + 1 <= params_.size()) {
    params_[0] = std::byte{reader.current_target_number()};
    std::memcpy(&params_[1], command.data(), command.size());
    params_len_ = command.size() + 1;

    // Reinitialize call_future_ with actual params
    call_future_ = Pn532CallFuture(
        reader.uart(),
        Pn532Command{kCmdInDataExchange,
                     pw::ConstByteSpan(params_.data(), params_len_)},
        deadline);
  }
  // If command too large, params_len_ stays 0 and DoPend returns error
}

Pn532TransceiveFuture::Pn532TransceiveFuture(
    Pn532TransceiveFuture&& other) noexcept
    : Base(Base::ConstructedState::kMovedFrom),
      reader_(other.reader_),
      response_buffer_(other.response_buffer_),
      params_(other.params_),
      params_len_(other.params_len_),
      call_future_(std::move(other.call_future_)) {
  Base::MoveFrom(other);
  other.reader_ = nullptr;
}

Pn532TransceiveFuture& Pn532TransceiveFuture::operator=(
    Pn532TransceiveFuture&& other) noexcept {
  Base::MoveFrom(other);
  reader_ = other.reader_;
  response_buffer_ = other.response_buffer_;
  params_ = other.params_;
  params_len_ = other.params_len_;
  call_future_ = std::move(other.call_future_);
  other.reader_ = nullptr;
  return *this;
}

pw::async2::Poll<pw::Result<size_t>> Pn532TransceiveFuture::DoPend(
    pw::async2::Context& cx) {
  using pw::async2::Pending;
  using pw::async2::Ready;

  if (reader_ == nullptr) {
    return Ready(pw::Status::FailedPrecondition());
  }

  if (params_len_ == 0) {
    return Ready(pw::Status::OutOfRange());  // Command was too large
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

pw::Result<size_t> Pn532TransceiveFuture::ParseResponse(
    pw::ConstByteSpan payload) {
  // InDataExchange response: [Status][DataIn...]
  if (payload.empty()) {
    return pw::Status::DataLoss();
  }

  uint8_t status = static_cast<uint8_t>(payload[0]);
  if (status != 0x00) {
    PW_LOG_WARN("InDataExchange error: %02x", status);
    if (status == 0x01) {
      return pw::Status::DeadlineExceeded();
    }
    return pw::Status::Internal();
  }

  // Copy response data (excluding status byte)
  size_t data_len = payload.size() - 1;
  if (data_len > response_buffer_.size()) {
    return pw::Status::ResourceExhausted();
  }

  std::memcpy(response_buffer_.data(), &payload[1], data_len);
  return data_len;
}

}  // namespace maco::nfc
