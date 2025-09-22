#pragma once

#include "../token_session/start_session.h"
#include "common.h"
#include "personalize.h"

namespace oww::state::tag {
using namespace oww::state::token_session;

struct Idle {};
struct Detected {};
struct Authenticated {
  std::array<uint8_t, 7> tag_uid;
};

struct Unknown {};


using TagState = std::variant<Idle, Detected, Authenticated, StartSession,
                              Personalize, Unknown>;

}  // namespace oww::state::tag
