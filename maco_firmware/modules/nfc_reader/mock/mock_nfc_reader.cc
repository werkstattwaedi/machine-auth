// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/nfc_reader/mock/mock_nfc_reader.h"

namespace maco::nfc {

TransceiveFuture MockNfcReader::RequestTransceive(
    pw::ConstByteSpan command,
    pw::ByteSpan response_buffer,
    pw::chrono::SystemClock::duration /*timeout*/) {
  last_command_.assign(command.begin(), command.end());
  transceive_count_++;

  // Delegate to the current tag's HandleTransceive
  if (!current_tag_) {
    return TransceiveFuture::Resolved(pw::Status::FailedPrecondition());
  }

  auto result = current_tag_->HandleTransceive(command, response_buffer);
  return TransceiveFuture::Resolved(std::move(result));
}

EventFuture MockNfcReader::SubscribeOnce() {
  return event_provider_.Get();
}

void MockNfcReader::SimulateTagArrival(std::shared_ptr<MockTag> tag) {
  tag->OnEnterField();
  current_tag_ = std::move(tag);
  NfcEvent event{NfcEventType::kTagArrived, current_tag_};
  event_provider_.Resolve(std::move(event));
}

void MockNfcReader::SimulateTagDeparture() {
  if (current_tag_) {
    current_tag_->OnLeaveField();
    current_tag_->Invalidate();
  }
  NfcEvent event{NfcEventType::kTagDeparted, nullptr};
  event_provider_.Resolve(std::move(event));
  current_tag_.reset();
}

std::shared_ptr<Iso14443TagMock> MockNfcReader::SimulateTagArrival(
    pw::ConstByteSpan uid, uint8_t sak) {
  auto tag = std::make_shared<Iso14443TagMock>(uid, sak);
  SimulateTagArrival(std::static_pointer_cast<MockTag>(tag));
  return tag;
}

}  // namespace maco::nfc
