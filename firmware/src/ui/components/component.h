#pragma once

#include <lvgl.h>

#include "hal/hardware_interface.h"
#include "state/iapplication_state.h"

namespace oww::ui {

class Component {
 public:
  Component(std::shared_ptr<state::IApplicationState> app,
            hal::IHardware* hardware = nullptr)
      : app_(app), hardware_(hardware) {};
  virtual ~Component() {};

  virtual void Render() = 0;

  operator lv_obj_t*();

  lv_obj_t* Root();

 protected:
  lv_obj_t* root_;
  std::shared_ptr<state::IApplicationState> app_;
  hal::IHardware* hardware_;
};

}  // namespace oww::ui
