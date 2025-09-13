#pragma once

#include "common.h"

namespace oww::state::session {

struct Idle {};

struct Active {
  String session_id;
  time_t start_timestamp;
  String user_id;
  String user_label;
};

struct Denied {
  String message;
};

using SessionState = std::variant<Idle, Active, Denied>;

}  // namespace oww::state::session
