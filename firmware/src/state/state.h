#pragma once

#include "../common.h"
#include "configuration.h"
#include "event/state_event.h"

namespace oww::state {

enum class TagState {
  kNone = 0,
  kReading = 1,
  kOwwAuthenticated = 2,
  kOwwAuthorized = 3,
  kOwwRejected = 4,
  kUnknown = 5,
  kBlank = 6,
  kPersonalizeCloud = 7,
  kPersonalizeWrite = 8,
};

class State : public event::IStateEvent {
 public:
  Status Begin(std::unique_ptr<Configuration> configuration);

  void Loop();

  Configuration* GetConfiguration() { return configuration_.get(); }

  TagState GetTagState() { return tag_state_; }

 private:
  std::unique_ptr<Configuration> configuration_ = nullptr;
  TagState tag_state_ = TagState::kNone;

  // kBlank
  system_tick_t personalize_timeout_ = CONCURRENT_WAIT_FOREVER;
  std::array<uint8_t, 7> blank_tag_id_;

 private:
  int StateCommand(String command);

 public:
  virtual void OnConfigChanged() override;

  virtual void OnTagFound() override;
  virtual void OnBlankNtag(std::array<uint8_t, 7> uid) override;
  virtual void OnOwwTagAuthenicated() override;
  virtual void OnOwwTagAuthorized() override;
  virtual void OnOwwTagRejected() override;
  virtual void OnUnknownTag() override;
  virtual void OnTagRemoved() override;
};

}  // namespace oww::state