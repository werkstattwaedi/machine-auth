#pragma once

#include "ui/components/component.h"

namespace oww::ui {

class SplashScreen : public Component {
 public:
  SplashScreen(std::shared_ptr<state::IApplicationState> app);
  virtual ~SplashScreen();

  virtual void Render() override;

 private:
  lv_obj_t* image_;
  lv_obj_t* progress_label_;
};

}  // namespace oww::ui
