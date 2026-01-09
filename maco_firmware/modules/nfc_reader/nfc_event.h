// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <memory>

namespace maco::nfc {

// Forward declaration
class NfcTag;

/// Event types sent through the channel to the application.
enum class NfcEventType {
  kTagArrived,   ///< A tag was detected and is ready for use
  kTagDeparted,  ///< The tag was removed from the field
};

/// Event sent to application via pw_async2 channel.
///
/// Contains the event type and a shared_ptr to the tag (for kTagArrived).
/// For kTagDeparted, the tag pointer may still be valid but the tag is
/// marked as invalid (is_valid() returns false).
struct NfcEvent {
  NfcEventType type;
  std::shared_ptr<NfcTag>
      tag;  ///< Set for kTagArrived, may be set for kTagDeparted
};

}  // namespace maco::nfc
