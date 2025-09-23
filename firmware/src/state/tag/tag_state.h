#pragma once

#include "common.h"

namespace oww::state::tag {

struct Idle {};
struct Detected {};
struct Authenticated {
  std::array<uint8_t, 7> tag_uid;
};

struct Unknown {};

using TagState = std::variant<Idle, Detected, Authenticated, Unknown>;

}  // namespace oww::state::tag
