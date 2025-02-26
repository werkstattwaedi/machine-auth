#pragma once

#include <lvgl.h>

#include "state/state.h"

namespace oww::ui {

class Component {
 public:
  Component(std::shared_ptr<oww::state::State> state) : state_(state) {};
  virtual ~Component() {};

  virtual void Render() = 0;

 private:
  std::shared_ptr<oww::state::State> state_;
};

}  // namespace oww::ui
