
#include "state.h"

#include "common/byte_array.h"

namespace oww::state {

Logger State::logger("state");

State::State() : boot_progress_("Starte...") {}

Status State::Begin(std::unique_ptr<Configuration> configuration) {
  os_mutex_create(&mutex_);

  configuration_ = std::move(configuration);
  configuration_->Begin();

  terminal_state_ = std::make_shared<terminal::State>(terminal::Idle{});

  CloudRequest::Begin();

  return Status::kOk;
}

void State::Loop() { CheckTimeouts(); }

void State::OnConfigChanged() { System.reset(RESET_REASON_CONFIG_UPDATE); }

void State::SetBootProgress(std::string message) { boot_progress_ = message; }
void State::BootCompleted() { boot_progress_.clear(); }
bool State::IsBootCompleted() { return boot_progress_.empty(); }
std::string State::GetBootProgress() { return boot_progress_; }

void State::OnTagFound() {
  logger.info("tag_state: OnTagFound");

  terminal_state_ = std::make_shared<terminal::State>(terminal::Detected{});
}

void State::OnBlankNtag(std::array<uint8_t, 7> uid) {
  logger.info("tag_state: OnBlankNtag");

  OnNewState(terminal::Personalize{
      .tag_uid = uid,
      .state = std::make_shared<terminal::personalize::State>(
          terminal::personalize::Wait{
              .timeout = millis() + 3000,
          })});
}

void State::OnTagAuthenicated(std::array<uint8_t, 7> uid) {
  logger.info("tag_state: OnTagAuthenicated");

  // TODO:
  // - check tap-out
  // - check pre-authorized.

  OnNewState(
      terminal::StartSession{.tag_uid = uid,
                             .state = std::make_shared<terminal::start::State>(
                                 terminal::start::StartWithNfcAuth{})});
}

void State::OnUnknownTag() {
  logger.info("tag_state: OnUnknownTag");

  terminal_state_ = std::make_shared<terminal::State>(terminal::Unknown{});
}

void State::OnTagRemoved() {
  logger.info("tag_state: OnTagRemoved");

  terminal_state_ = std::make_shared<terminal::State>(terminal::Idle{});
}

void State::OnNewState(oww::state::terminal::StartSession state) {
  using namespace oww::state::terminal::start;

  terminal_state_ = std::make_shared<terminal::State>(state);
}
void State::OnNewState(oww::state::terminal::Personalize state) {
  using namespace oww::state::terminal::personalize;

  terminal_state_ = std::make_shared<terminal::State>(state);

  using namespace oww::state::terminal::personalize;
  if (auto nested = std::get_if<Failed>(state.state.get())) {
    logger.error("Failed to personailize: error: %d, message: %s",
                 (int)nested->error, nested->message.c_str());
  }
}

}  // namespace oww::state
