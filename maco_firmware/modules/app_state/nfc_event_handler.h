// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <optional>

#include "maco_firmware/modules/app_state/app_state.h"
#include "maco_firmware/modules/nfc_reader/nfc_event.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/task.h"

namespace maco::app_state {

/// Bridges NFC reader events to application state.
///
/// This task subscribes to NFC events and updates the AppState accordingly:
/// - kTagArrived -> AppState::OnTagDetected(uid)
/// - kTagDeparted -> AppState::OnTagRemoved()
///
/// Usage:
///   NfcEventHandler handler(nfc_reader, app_state);
///   handler.Start(dispatcher);
class NfcEventHandler {
 public:
  NfcEventHandler(nfc::NfcReader& reader, AppState& app_state)
      : reader_(reader), app_state_(app_state), task_(*this) {}

  /// Start the event handler task.
  /// @param dispatcher The async dispatcher to register with
  void Start(pw::async2::Dispatcher& dispatcher);

 private:
  class EventTask : public pw::async2::Task {
   public:
    explicit EventTask(NfcEventHandler& parent) : parent_(parent) {}

   private:
    pw::async2::Poll<> DoPend(pw::async2::Context& cx) override;
    NfcEventHandler& parent_;
  };

  void Subscribe();
  void HandleEvent(const nfc::NfcEvent& event);

  nfc::NfcReader& reader_;
  AppState& app_state_;
  EventTask task_;
  std::optional<nfc::EventFuture> event_future_;
};

}  // namespace maco::app_state
