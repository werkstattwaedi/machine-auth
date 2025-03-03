#pragma once

#include "component.h"

namespace oww::ui {

class TagStatus : public Component {
 public:
  TagStatus(lv_obj_t* parent, std::shared_ptr<oww::state::State> state);
  virtual ~TagStatus();

  virtual void Render() override;

 private:
 oww::state::TagState last_state_;
 lv_obj_t* status_led = nullptr;
 lv_obj_t* status_label = nullptr;
};

}  // namespace oww::ui
