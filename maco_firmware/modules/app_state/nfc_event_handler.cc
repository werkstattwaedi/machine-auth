// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "NFC"

#include "maco_firmware/modules/app_state/nfc_event_handler.h"

#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "pw_log/log.h"

namespace maco::app_state {

void NfcEventHandler::Start(pw::async2::Dispatcher& dispatcher) {
  Subscribe();
  dispatcher.Post(task_);
}

void NfcEventHandler::Subscribe() {
  event_future_.emplace(reader_.SubscribeOnce());
}

void NfcEventHandler::HandleEvent(const nfc::NfcEvent& event) {
  switch (event.type) {
    case nfc::NfcEventType::kTagArrived:
      if (event.tag) {
        PW_LOG_INFO("Tag arrived: %u bytes UID",
                    static_cast<unsigned>(event.tag->uid().size()));
        app_state_.OnTagDetected(event.tag->uid());
      } else {
        PW_LOG_WARN("Tag arrived event with null tag");
      }
      break;

    case nfc::NfcEventType::kTagDeparted:
      PW_LOG_INFO("Tag departed");
      app_state_.OnTagRemoved();
      break;
  }
}

pw::async2::Poll<> NfcEventHandler::EventTask::DoPend(pw::async2::Context& cx) {
  if (parent_.event_future_.has_value()) {
    auto poll = parent_.event_future_->Pend(cx);
    if (poll.IsReady()) {
      nfc::NfcEvent event = std::move(poll.value());
      parent_.event_future_.reset();

      // Handle the event
      parent_.HandleEvent(event);

      // Re-subscribe for the next event
      parent_.Subscribe();
    }
  }

  // The future's waker will wake this task when resolved - no need to ReEnqueue
  return pw::async2::Pending();
}

}  // namespace maco::app_state
