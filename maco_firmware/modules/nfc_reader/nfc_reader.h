// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <memory>
#include <optional>

#include "maco_firmware/modules/nfc_reader/nfc_reader_driver.h"
#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "pw_chrono/system_clock.h"
#include "pw_log/log.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace maco::nfc {

/// Events emitted by NfcReader.
enum class NfcReaderEvent {
  kTagArrived,
  kTagDeparted,
};

/// NFC Reader managing tag detection and lifecycle.
///
/// Owns the current tag via shared_ptr. Applications can hold shared_ptr
/// to tags - when a tag is removed, it is marked invalid but not destroyed
/// until all references are released.
///
/// @tparam Driver NFC driver type (CRTP base derived class)
/// @tparam TagType The type of tag to create (e.g., Iso14443Tag<Driver>)
template <typename Driver, typename TagType>
class NfcReader {
 public:
  /// Construct an NFC reader.
  /// @param driver Reference to the NFC driver
  explicit NfcReader(Driver& driver) : driver_(driver) {}

  /// Initialize the reader.
  pw::Status Init() { return driver_.Init(); }

  /// Poll for tag detection or departure.
  ///
  /// This is a blocking call. It will:
  /// - If no tag present: try to detect a new tag
  /// - If tag present: check if tag is still in field
  ///
  /// @param timeout Maximum time to wait
  /// @return Event type, or error
  pw::Result<NfcReaderEvent> Poll(pw::chrono::SystemClock::duration timeout) {
    if (current_tag_) {
      // Tag present - check if still there
      auto result = driver_.CheckTagPresent(timeout);
      if (!result.ok()) {
        // Error checking presence - treat as departed
        OnTagRemoved();
        return NfcReaderEvent::kTagDeparted;
      }

      if (!result.value()) {
        // Tag removed
        OnTagRemoved();
        return NfcReaderEvent::kTagDeparted;
      }

      // Tag still present - no event
      return pw::Status::DeadlineExceeded();
    } else {
      // No tag - try to detect
      auto result = driver_.DetectTag(timeout);
      if (!result.ok()) {
        if (result.status().IsNotFound()) {
          // No tag detected - not an error, just timeout
          return pw::Status::DeadlineExceeded();
        }
        return result.status();
      }

      // Tag detected - create tag object
      current_tag_ = std::make_shared<TagType>(driver_, result.value());
      PW_LOG_INFO("Tag arrived");
      return NfcReaderEvent::kTagArrived;
    }
  }

  /// Get the current tag, if present.
  /// @return Shared pointer to tag, or nullptr if no tag
  std::shared_ptr<NfcTag> GetCurrentTag() { return current_tag_; }

  /// Get the current tag as a specific type.
  /// @tparam T Tag type to cast to
  /// @return Shared pointer to tag, or nullptr if no tag or wrong type
  template <typename T>
  std::shared_ptr<T> GetTagAs() {
    return std::dynamic_pointer_cast<T>(current_tag_);
  }

  /// Check if a tag is currently present.
  bool HasTag() const { return current_tag_ != nullptr; }

 private:
  void OnTagRemoved() {
    if (current_tag_) {
      // Invalidate the tag
      current_tag_->Invalidate();

      // Release tag from driver
      auto* iso_tag = dynamic_cast<TagType*>(current_tag_.get());
      if (iso_tag) {
        driver_.ReleaseTag(iso_tag->target_number());
      }

      // Clear our reference (tag may live if app still holds ref)
      current_tag_.reset();

      PW_LOG_INFO("Tag departed");
    }
  }

  Driver& driver_;
  std::shared_ptr<NfcTag> current_tag_;
};

}  // namespace maco::nfc
