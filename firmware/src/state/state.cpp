
#include "state.h"

#include <iomanip>
#include <sstream>

namespace oww::state {

Status State::Begin(std::unique_ptr<Configuration> configuration) {
  configuration_ = std::move(configuration);
  configuration_->Begin();

  Particle.function("State", &State::StateCommand, this);

  return Status::kOk;
}

int State::StateCommand(String arguments) {
  Log.error("StateCommand %s", arguments.c_str());
  JSONValue outerObj = JSONValue::parseCopy(arguments);

  return 0;
}

std::string arrayToHexString(const std::array<uint8_t, 7>& arr) {
  std::stringstream ss;
  ss << std::hex << std::setfill('0');
  for (uint8_t byte : arr) {
    ss << std::setw(2) << static_cast<int>(byte);
  }
  return ss.str();
}

void State::Loop() {
  if (tag_state_ == TagState::kBlank && millis() > personalize_timeout_) {
    tag_state_ = TagState::kPersonalizeCloud;

    auto blank_tag_id_string = arrayToHexString(blank_tag_id_);

    Variant payload;
    payload.set("type", Variant("blank-tag"));
    payload.set("uid", Variant(String(blank_tag_id_string.c_str())));
    Particle.publish("terminal", payload);
    Log.error("PUBLISHED");
  }
}

void State::OnConfigChanged() { System.reset(RESET_REASON_CONFIG_UPDATE); }

void State::OnTagFound() { tag_state_ = TagState::kReading; }
void State::OnBlankNtag(std::array<uint8_t, 7> uid) {
  tag_state_ = TagState::kBlank;
  blank_tag_id_ = uid;
  personalize_timeout_ = millis() + 3000;
}
void State::OnOwwTagAuthenicated() { tag_state_ = TagState::kOwwAuthenticated; }
void State::OnOwwTagAuthorized() { tag_state_ = TagState::kOwwAuthorized; }
void State::OnOwwTagRejected() { tag_state_ = TagState::kOwwRejected; }
void State::OnUnknownTag() { tag_state_ = TagState::kUnknown; }
void State::OnTagRemoved() { tag_state_ = TagState::kNone; }

}  // namespace oww::state
