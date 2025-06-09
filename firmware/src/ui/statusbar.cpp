#include "statusbar.h"

namespace oww::ui {

StatusBar::StatusBar(lv_obj_t* parent, std::shared_ptr<oww::state::State> state)
    : Component(state) {
  root_ = lv_obj_create(parent);
  lv_obj_set_style_bg_color(root_, lv_color_hex(0xdddddd), LV_PART_MAIN);

  machine_label_ = lv_label_create(root_);
  lv_obj_align(machine_label_, LV_ALIGN_LEFT_MID, 10, 0);

  auto configuration = state_->GetConfiguration();
  lv_label_set_text(machine_label_,
                    configuration->IsConfigured()
                        ? configuration->GetTerminal()->label.c_str()
                        : "unconfigured");
}

StatusBar::~StatusBar() { lv_obj_delete(root_); }

void StatusBar::Render() {}

}  // namespace oww::ui