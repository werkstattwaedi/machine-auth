
#include "state.h"

#include "common/hex_util.h"

namespace oww::state {

Logger State::logger(oww::state::configuration::logtag);

Status State::Begin(std::unique_ptr<Configuration> configuration) {
  os_mutex_create(&mutex_);

  configuration_ = std::move(configuration);
  configuration_->Begin();

  tag_state_ = std::make_shared<tag::State>(tag::Idle{});

  CloudRequest::Begin();

  return Status::kOk;
}

void State::Loop() {
  if (auto state = std::get_if<tag::Authorize>(tag_state_.get())) {
    if (auto new_state =
            tag::StateLoop(*state, *static_cast<CloudRequest*>(this))) {
      tag_state_ = std::make_shared<tag::State>(new_state.value());
    }
  } else if (auto state = std::get_if<tag::Personalize>(tag_state_.get())) {
    if (auto new_state =
            tag::StateLoop(*state, *static_cast<CloudRequest*>(this))) {
      tag_state_ = std::make_shared<tag::State>(new_state.value());
    }
  }
}

void State::OnConfigChanged() { System.reset(RESET_REASON_CONFIG_UPDATE); }

void State::OnTagFound() {
  tag_state_ = std::make_shared<tag::State>(tag::Detected{});
}

void State::OnBlankNtag(std::array<std::byte, 7> uid) {
  tag_state_ = std::make_shared<tag::State>(tag::Personalize{
      .tag_uid = uid,
      .state = std::make_shared<tag::personalize::State>(tag::personalize::Wait{
          .timeout = millis() + 3000,
      })});
}

void State::OnTagAuthenicated(std::array<std::byte, 7> uid) {
  tag_state_ = std::make_shared<tag::State>(tag::Authenticated{.tag_uid = uid});
}

void State::OnUnknownTag() {
  tag_state_ = std::make_shared<tag::State>(tag::Unknown{});
}

void State::OnTagRemoved() {
  tag_state_ = std::make_shared<tag::State>(tag::Idle{});
}

}  // namespace oww::state
