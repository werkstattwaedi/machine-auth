#pragma once

#include "component.h"

namespace oww::ui {

class StatusBar : public Component {
 public:
  StatusBar(lv_obj_t* parent, std::shared_ptr<oww::state::State> state);
  virtual ~StatusBar();

  virtual void Render() override;

 private:
  lv_obj_t* container_;
};

}  // namespace oww::ui
