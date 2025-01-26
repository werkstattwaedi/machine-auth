#pragma once

#include "libbase.h"

namespace oww::state::event {

class IStateEvent {
 public:
  virtual void OnConfigChanged() = 0;
};


}  // namespace oww::state