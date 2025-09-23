
#include "state.h"

#include "common/byte_array.h"

namespace oww::state {

Logger State::logger("state");

State::State() : boot_progress_("Starte...") {}

Status State::Begin(std::unique_ptr<Configuration> configuration) {
  os_mutex_create(&mutex_);

  configuration_ = std::move(configuration);
  configuration_->Begin();

  tag_state_ = std::make_shared<tag::TagState>(tag::Idle{});
  sessions_.Begin();

  pinMode(config::ext::pin_relais, INPUT);
  relais_state_ = digitalRead(config::ext::pin_relais) ? HIGH : LOW;
  if (relais_state_ == HIGH) {
    Log.warn("Relais was ON at startup");
  }

  // TODO: Enable the external I2C bus bases on the configuration.
  pinMode(config::ext::pin_i2c_enable, OUTPUT);
  digitalWrite(config::ext::pin_i2c_enable, HIGH);

  CloudRequest::Begin();

  return Status::kOk;
}

void State::Loop() {
  CheckTimeouts();
  UpdateRelaisState();
  sessions_.Loop();
}

void State::OnConfigChanged() { System.reset(RESET_REASON_CONFIG_UPDATE); }

void State::SetBootProgress(std::string message) {
  boot_progress_ = message;
  logger.info("Boot progress: %s", boot_progress_.c_str());
}
void State::BootCompleted() { boot_progress_.clear(); }
bool State::IsBootCompleted() { return boot_progress_.empty(); }
std::string State::GetBootProgress() { return boot_progress_; }

void State::UpdateRelaisState() {
  using namespace oww::state::tag;
  PinState expected_relais_state;
  if (std::get_if<StartSession>(tag_state_.get())) {
    expected_relais_state = HIGH;
  } else {
    expected_relais_state = LOW;
  }

  if (relais_state_ != expected_relais_state) {
    relais_state_ = expected_relais_state;
    logger.info("Toggle Relais %s", relais_state_ == HIGH ? "HIGH" : "LOW");

    digitalWrite(config::ext::pin_relais, relais_state_);
    pinMode(config::ext::pin_relais, OUTPUT);
    digitalWrite(config::ext::pin_relais, relais_state_);
    delay(50);
    pinMode(config::ext::pin_relais, INPUT);

    auto actual_state = digitalRead(config::ext::pin_relais) ? HIGH : LOW;
    if (actual_state != relais_state_) {
      Log.error("Failed to toggle actual relais state");
    }
  }
}

void State::OnTagFound() {
  logger.info("tag_state: OnTagFound");

  tag_state_ = std::make_shared<tag::TagState>(tag::Detected{});
}

void State::OnBlankNtag(std::array<uint8_t, 7> uid) {
  logger.info("tag_state: OnBlankNtag");

  OnNewState(tag::Personalize{
      .tag_uid = uid,
      .state = std::make_shared<tag::personalize::State>(tag::personalize::Wait{
          .timeout = millis() + 3000,
      })});
}

void State::OnTagAuthenicated(std::array<uint8_t, 7> uid) {
  logger.info("tag_state: OnTagAuthenicated");

  OnNewState(tag::StartSession{
      .tag_uid = uid,
      .state = std::make_shared<tag::start::NestedState>(tag::start::Begin{})});
}

void State::OnUnknownTag() {
  logger.info("tag_state: OnUnknownTag");

  tag_state_ = std::make_shared<tag::TagState>(tag::Unknown{});
}

void State::OnTagRemoved() {
  logger.info("tag_state: OnTagRemoved");

  tag_state_ = std::make_shared<tag::TagState>(tag::Idle{});
}

void State::OnNewState(oww::state::tag::StartSession state) {
  using namespace oww::state::tag::start;

  tag_state_ = std::make_shared<tag::TagState>(state);
}
void State::OnNewState(oww::state::tag::Personalize state) {
  using namespace oww::state::tag::personalize;

  tag_state_ = std::make_shared<tag::TagState>(state);

  using namespace oww::state::tag::personalize;
  if (auto nested = std::get_if<Failed>(state.state.get())) {
    logger.error("Failed to personailize: error: %d, message: %s",
                 (int)nested->error, nested->message.c_str());
  }
}

}  // namespace oww::state
