#pragma once

#include "../../common.h"
#include "authorize.h"
#include "personalize.h"

namespace oww::state::tag {

struct Idle {};
struct Detected {};
struct Authenticated {
  std::array<std::byte, 7> tag_uid;
};
struct Unknown {};

using State = std::variant<Idle, Detected, Authenticated, Authorize,
                           Personalize, Unknown>;

}  // namespace oww::state::tag
