#pragma once

#include <array>
#include <memory>
#include <string>
#include <variant>

#include "session_creation.h"
#include "state_machine.h"

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
  std::shared_ptr<session_creation::SessionCreationStateMachine> creation_sm;
};

}  // namespace oww::state::tag

namespace oww::state {

// Tag state machine (tracks NFC tag status and session creation)
using TagStateMachine = StateMachine<
    tag::NoTag,
    tag::AuthenticatedTag,
    tag::SessionTag,
    tag::UnsupportedTag>;

using TagState = TagStateMachine::State;
using TagStateHandle = TagStateMachine::StateHandle;

}  // namespace oww::state
