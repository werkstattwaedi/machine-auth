#pragma once

#include "common.h"
#include "nfc/driver/PN532.h"

namespace oww::nfc {

// A tag is not in the field.
struct WaitForTag {};

// A generic ISO14443-A tag is in the field.
struct TagPresent {
  std::shared_ptr<SelectedTag> selected_tag;
};

// An NTAG424 tag is in the field, but not authenticated with the terminal key.
// This could be a blank tag, or a tag from another system.
struct Ntag424Unauthenticated {
  std::shared_ptr<SelectedTag> selected_tag;
  std::array<uint8_t, 7> uid;
};

// An NTAG424 tag is in the field and authenticated with the terminal key.
struct Ntag424Authenticated {
  std::shared_ptr<SelectedTag> selected_tag;
  std::array<uint8_t, 7> uid;
};

// There was an error communicating with the tag.
struct TagError {
  std::shared_ptr<SelectedTag> selected_tag;
  int32_t error_count = 0;
};

using NfcStateMachine =
    oww::common::StateMachine<oww::nfc::WaitForTag, oww::nfc::TagPresent,
                              oww::nfc::Ntag424Unauthenticated,
                              oww::nfc::Ntag424Authenticated,
                              oww::nfc::TagError>;

static const NfcStateMachine::Query HasTag([](const auto& state) {
  return !std::holds_alternative<oww::nfc::WaitForTag>(state);
});

}  // namespace oww::nfc
