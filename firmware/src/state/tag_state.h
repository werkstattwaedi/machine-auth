#pragma once

#include <array>
#include <memory>
#include <string>
#include <variant>

#include "session_creation.h"

namespace oww::state {
class TokenSession;
}

namespace oww::state::tag {

// No tag present in NFC field
struct NoTag {};

// Tag present but unsupported (not NTAG424 or authentication failed)
struct UnsupportedTag {
  std::array<uint8_t, 7> tag_uid;
  std::string reason;
};

// Tag authenticated with terminal key - decision point for session creation
struct AuthenticatedTag {
  std::array<uint8_t, 7> tag_uid;
};

// Session creation in progress or session active
struct SessionTag {
  std::array<uint8_t, 7> tag_uid;
  session_creation::SessionCreationStateHandle creation_state;
};

}  // namespace oww::state::tag

namespace oww::state {

// Tag state variant (tracks NFC tag status)
using TagState = std::variant<
    tag::NoTag,
    tag::UnsupportedTag,
    tag::AuthenticatedTag,
    tag::SessionTag>;

using TagStateHandle = std::shared_ptr<TagState>;

}  // namespace oww::state
