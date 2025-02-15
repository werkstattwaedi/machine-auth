#pragma once

#include "libbase.h"

namespace oww::state::event {

class IStateEvent {
 public:
  virtual void OnConfigChanged() = 0;


  // NFC Events
  virtual void OnTagFound() = 0;
  virtual void OnTagBlank() = 0;
  virtual void OnTagVerified() = 0;
  virtual void OnTagRejected() = 0;
  virtual void OnTagRemoved() = 0;


};


}  // namespace oww::state