
#include "state.h"

namespace oww::state {

Status State::Begin(std::unique_ptr<Configuration> configuration) {
  configuration_ = std::move(configuration);
  configuration_->Begin();

  return Status::kOk;
}

void State::Loop() {}

void State::OnConfigChanged() { System.reset(RESET_REASON_CONFIG_UPDATE); }

void State::OnTagFound() { tag_state_ = TagState::kReading; }
void State::OnBlankNtag() { tag_state_ = TagState::kBlank; }
void State::OnOwwTagAuthenicated() { tag_state_ = TagState::kOwwAuthenticated; }
void State::OnOwwTagAuthorized() { tag_state_ = TagState::kOwwAuthorized; }
void State::OnOwwTagRejected() { tag_state_ = TagState::kOwwRejected; }
void State::OnUnknownTag() { tag_state_ = TagState::kUnknown; }
void State::OnTagRemoved() { tag_state_ = TagState::kNone; }

}  // namespace oww::state
