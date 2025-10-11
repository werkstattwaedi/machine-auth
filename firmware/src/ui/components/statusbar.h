#pragma once

#include "ui/components/component.h"

namespace oww::ui {

class StatusBar : public Component {
 public:
  StatusBar(lv_obj_t* parent, std::shared_ptr<state::IApplicationState> app,
            const std::string& machine_label);
  virtual ~StatusBar();

  virtual void Render() override;

 private:
  lv_obj_t* machine_label_ = nullptr;
};

}  // namespace oww::ui
