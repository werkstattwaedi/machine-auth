#pragma once

#include "../../common.h"
#include "state/terminal/state.h"

namespace oww::state::event {

class IStateEvent {
 public:
  virtual void OnConfigChanged() = 0;

  // NFC Events
  // A ISO tag found, not clear whether its the right tag, or its valid
  virtual void OnTagFound() = 0;
  virtual void OnBlankNtag(std::array<uint8_t, 7> uid) = 0;
  virtual void OnTagAuthenicated(std::array<uint8_t, 7> uid) = 0;
  virtual void OnUnknownTag() = 0;
  virtual void OnTagRemoved() = 0;

  virtual void OnNewState(oww::state::terminal::StartSession state) = 0;
  virtual void OnNewState(oww::state::terminal::Personalize state) = 0;
};

}  // namespace oww::state::event