#pragma once

#include "component.h"

namespace oww::ui {

class SplashScreen : public Component {
 public:
  SplashScreen(std::shared_ptr<oww::state::State> state);
  virtual ~SplashScreen();

  virtual void Render() override;

 private:
  lv_obj_t* image_;
};

}  // namespace oww::ui
