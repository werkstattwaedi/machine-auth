
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
      OnNewState(new_state.value());
    }
  } else if (auto state = std::get_if<tag::Personalize>(tag_state_.get())) {
    if (auto new_state =
            tag::StateLoop(*state, *static_cast<CloudRequest*>(this))) {
      OnNewState(new_state.value());
    }
  }
}

void State::OnConfigChanged() { System.reset(RESET_REASON_CONFIG_UPDATE); }

void State::OnTagFound() {
  logger.info("tag_state: OnTagFound");

  tag_state_ = std::make_shared<tag::State>(tag::Detected{});
}

void State::OnBlankNtag(std::array<std::byte, 7> uid) {
  logger.info("tag_state: OnBlankNtag");

  tag_state_ = std::make_shared<tag::State>(tag::Personalize{
      .tag_uid = uid,
      .state = std::make_shared<tag::personalize::State>(tag::personalize::Wait{
          .timeout = millis() + 3000,
      })});
}

void State::OnTagAuthenicated(std::array<std::byte, 7> uid) {
  logger.info("tag_state: OnTagAuthenicated");

  tag_state_ = std::make_shared<tag::State>(tag::Authenticated{.tag_uid = uid});
}

void State::OnUnknownTag() {
  logger.info("tag_state: OnUnknownTag");

  tag_state_ = std::make_shared<tag::State>(tag::Unknown{});
}

void State::OnTagRemoved() {
  logger.info("tag_state: OnTagRemoved");

  tag_state_ = std::make_shared<tag::State>(tag::Idle{});
}

void State::OnNewState(oww::state::tag::Authorize state) {
  using namespace oww::state::tag::authorize;

  if (logger.isInfoEnabled()) {
    std::visit(
        overloaded{
            [](Start state) { logger.info("tag_state: Authorize::Start"); },
            [](NtagChallenge state) {
              logger.info("tag_state: Authorize::NtagChallenge");
            },
            [](AwaitCloudChallenge state) {
              logger.info("tag_state: Authorize::AwaitCloudChallenge");
            },
            [](AwaitAuthPart2Response state) {
              logger.info("tag_state: Authorize::AwaitAuthPart2Response");
            },
            [](Succeeded state) {
              logger.info("tag_state: Authorize::Succeeded");
            },
            [](Rejected state) {
              logger.info("tag_state: Authorize::Rejected");
            },
            [](Failed state) { logger.info("tag_state: Authorize::Failed"); },
        },
        *(state.state.get()));
  }

  tag_state_ = std::make_shared<tag::State>(state);
}
void State::OnNewState(oww::state::tag::Personalize state) {
  using namespace oww::state::tag::personalize;

  if (logger.isInfoEnabled()) {
    std::visit(
        overloaded{
            [](Wait state) { logger.info("tag_state: Personalize::Wait"); },
            [](KeyDiversification state) {
              logger.info("tag_state: Personalize::KeyDiversification");
            },
            [](UpdateTag state) {
              logger.info("tag_state: Personalize::UpdateTag");
            },
            [](Completed state) {
              logger.info("tag_state: Personalize::Completed");
            },
            [](Failed state) {
              logger.info("tag_state: Personalize::Failed");
            }},
        *(state.state.get()));
  }

  tag_state_ = std::make_shared<tag::State>(state);
}

}  // namespace oww::state
