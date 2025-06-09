#pragma once

#include "common.h"
#include "personalize.h"
#include "start_session.h"

namespace oww::state::terminal {

struct Idle {};
struct Detected {};
struct Authenticated {
  std::array<uint8_t, 7> tag_uid;
};
struct Unknown {};

using State = std::variant<Idle, Detected, Authenticated, StartSession,
                           Personalize, Unknown>;

}  // namespace oww::state::terminal
