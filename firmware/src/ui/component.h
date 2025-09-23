#pragma once

#include <lvgl.h>

#include "app/application.h"

namespace oww::ui {

class Component {
 public:
  Component(std::shared_ptr<oww::app::Application> app) : app_(app) {};
  virtual ~Component() {};

  virtual void Render() = 0;

  operator lv_obj_t*();

  lv_obj_t* Root();

 protected:
  lv_obj_t* root_;
  std::shared_ptr<oww::app::Application> app_;
};

}  // namespace oww::ui
