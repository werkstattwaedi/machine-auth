#pragma once

#include <lvgl.h>

#include "state/state.h"

namespace oww::ui {

class Component {
 public:
  Component(std::shared_ptr<oww::state::State> state) : state_(state) {};
  virtual ~Component() {};

  virtual void Render() = 0;

  // operator lv_obj_t*();
  lv_obj_t* Root();

 protected:
  lv_obj_t* root_;
  std::shared_ptr<oww::state::State> state_;
};

}  // namespace oww::ui
