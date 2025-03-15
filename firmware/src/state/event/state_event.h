#pragma once

#include "../../common.h"

namespace oww::state::event {

class IStateEvent {
 public:
  virtual void OnConfigChanged() = 0;

  // NFC Events
  // A ISO tag found, not clear whether its the right tag, or its valid
  virtual void OnTagFound() = 0;
  virtual void OnBlankNtag(std::array<std::byte, 7> uid) = 0;
  virtual void OnTagAuthenicated(std::array<std::byte, 7> uid) = 0;
  virtual void OnUnknownTag() = 0;
  virtual void OnTagRemoved() = 0;
};

}  // namespace oww::state::event