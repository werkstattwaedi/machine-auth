// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/nfc_reader/mock/mock_nfc_reader.h"

#include <algorithm>

namespace maco::nfc {

TransceiveFuture MockNfcReader::RequestTransceive(
    pw::ConstByteSpan command,
    pw::ByteSpan response_buffer,
    pw::chrono::SystemClock::duration /*timeout*/) {
  // Record the command for inspection
  last_command_.assign(command.begin(), command.end());
  transceive_count_++;

  // Determine result
  pw::Result<size_t> result;
  if (next_transceive_error_.has_value()) {
    result = next_transceive_error_.value();
    next_transceive_error_.reset();
  } else if (!next_transceive_response_.empty()) {
    // Copy response to buffer
    size_t copy_len =
        std::min(next_transceive_response_.size(), response_buffer.size());
    std::copy(next_transceive_response_.begin(),
              next_transceive_response_.begin() + copy_len,
              response_buffer.begin());
    result = copy_len;
    next_transceive_response_.clear();
  } else {
    // No response configured, return empty response
    result = size_t{0};
  }

  // Return immediately resolved future
  return TransceiveFuture::Resolved(std::move(result));
}

EventFuture MockNfcReader::SubscribeOnce() {
  // If there's a pending event, return it immediately
  if (pending_event_.has_value()) {
    NfcEvent event = std::move(*pending_event_);
    pending_event_.reset();
    return EventFuture::Resolved(std::move(event));
  }

  // Otherwise, return a future that will be resolved later
  // For simplicity in the mock, we just return a pending future
  // In practice, the mock should be used synchronously (set up event, then
  // subscribe)
  //
  // TODO: Implement proper async event delivery using ValueProvider
  // For now, this will never resolve if no pending event
  return EventFuture::Resolved(
      NfcEvent{NfcEventType::kTagDeparted, nullptr});  // Default event
}

void MockNfcReader::SimulateTagArrival(std::shared_ptr<NfcTag> tag) {
  current_tag_ = std::move(tag);
  pending_event_ = NfcEvent{NfcEventType::kTagArrived, current_tag_};
}

void MockNfcReader::SimulateTagDeparture() {
  if (current_tag_) {
    current_tag_->Invalidate();
    pending_event_ = NfcEvent{NfcEventType::kTagDeparted, nullptr};
    current_tag_.reset();
  }
}

std::shared_ptr<MockTag> MockNfcReader::SimulateTagArrival(
    pw::ConstByteSpan uid, uint8_t sak) {
  auto tag = std::make_shared<MockTag>(uid, sak);
  SimulateTagArrival(tag);
  return tag;
}

void MockNfcReader::SetNextTransceiveResponse(pw::ConstByteSpan response) {
  next_transceive_response_.assign(response.begin(), response.end());
  next_transceive_error_.reset();
}

void MockNfcReader::SetNextTransceiveError(pw::Status status) {
  next_transceive_error_ = status;
  next_transceive_response_.clear();
}

}  // namespace maco::nfc
