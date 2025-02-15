#pragma once

#include "configuration.h"
#include "event/state_event.h"
#include "libbase.h"

namespace oww::state {

class State : public event::IStateEvent {
 public:
  Status Begin(std::unique_ptr<Configuration> configuration);

  void Loop();

  Configuration* GetConfiguration() { return configuration_.get(); }

 private:
  std::unique_ptr<Configuration> configuration_ = nullptr;

 public:
  virtual void OnConfigChanged() override;

  virtual void OnTagFound() override;
  virtual void OnTagBlank() override;
  virtual void OnTagVerified() override;
  virtual void OnTagRejected() override;
  virtual void OnTagRemoved() override;
};

}  // namespace oww::state