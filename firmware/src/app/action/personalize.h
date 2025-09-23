#pragma once

#include "app/cloud_response.h"
#include "common.h"
#include "fbs/personalization_generated.h"
#include "nfc/driver/Ntag424.h"

namespace oww::app {
class Application;
}  // namespace oww::app

namespace oww::app::action {

namespace personalize {

struct Wait {
  const system_tick_t timeout = CONCURRENT_WAIT_FOREVER;
};

struct AwaitKeyDiversificationResponse {
  const std::shared_ptr<CloudResponse<fbs::KeyDiversificationResponseT>>
      response;
};

struct DoPersonalizeTag {
  const std::array<uint8_t, 16> application_key;
  const std::array<uint8_t, 16> terminal_key;
  const std::array<uint8_t, 16> card_key;
  const std::array<uint8_t, 16> reserved_1_key;
  const std::array<uint8_t, 16> reserved_2_key;
};

struct Completed {};

struct Failed {
  const ErrorType error;
  const String message;
};

using State = std::variant<Wait, AwaitKeyDiversificationResponse,
                           DoPersonalizeTag, Completed, Failed>;

}  // namespace personalize

struct Personalize {
  std::array<uint8_t, 7> tag_uid;
  std::shared_ptr<personalize::State> state;
};

void Loop(Personalize start_session_state, oww::app::Application &state_manager,
          Ntag424 &ntag_interface);

}  // namespace oww::app::action
