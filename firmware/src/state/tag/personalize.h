#pragma once

#include "../../common.h"
#include "nfc/driver/Ntag424.h"
#include "state/cloud_request.h"

namespace oww::state::tag {

namespace personalize {

struct Wait {
  const system_tick_t timeout = CONCURRENT_WAIT_FOREVER;
};

struct KeyDiversification {
  const std::shared_ptr<CloudResponse> response;
};

struct UpdateTag {
  const std::array<std::byte, 16> application_key;
  const std::array<std::byte, 16> terminal_key;
  const std::array<std::byte, 16> card_key;
  const std::array<std::byte, 16> reserved_1_key;
  const std::array<std::byte, 16> reserved_2_key;
};

struct Completed {};

struct Failed {
  const ErrorType error;
  const String message;
};

using State =
    std::variant<Wait, KeyDiversification, UpdateTag, Completed, Failed>;

}  // namespace personalize

struct Personalize {
  std::array<std::byte, 7> tag_uid;
  std::shared_ptr<personalize::State> state;

  Personalize WithNestedState(personalize::State nested_state);
};

std::optional<Personalize> StateLoop(Personalize state,
                                     CloudRequest &cloud_interface);

std::optional<Personalize> NfcLoop(Personalize state, Ntag424 &ntag_interface);

}  // namespace oww::state::tag
