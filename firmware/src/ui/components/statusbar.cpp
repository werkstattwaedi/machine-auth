#include "ui/components/statusbar.h"

namespace oww::ui {

StatusBar::StatusBar(lv_obj_t* parent,
                     std::shared_ptr<state::IApplicationState> app,
                     const std::string& machine_label)
    : Component(app) {
  // StatusBar: 240×58px at top of screen
  root_ = lv_obj_create(parent);
  lv_obj_remove_style_all(root_);
  lv_obj_set_size(root_, 240, 58);
  lv_obj_set_style_bg_color(root_, lv_color_hex(0xdddddd), LV_PART_MAIN);
  lv_obj_set_style_bg_opa(root_, LV_OPA_COVER, LV_PART_MAIN);

  // Content area: 236×58px with 2px margins on left/right (as per mockup)
  lv_obj_set_style_pad_left(root_, 2, 0);
  lv_obj_set_style_pad_right(root_, 2, 0);
  lv_obj_set_style_pad_top(root_, 0, 0);
  lv_obj_set_style_pad_bottom(root_, 0, 0);

  machine_label_ = lv_label_create(root_);
  lv_obj_align(machine_label_, LV_ALIGN_LEFT_MID, 10, 0);
  lv_obj_set_style_text_color(machine_label_, lv_color_hex(0x333333),
                              LV_PART_MAIN);

  lv_label_set_text(machine_label_, machine_label.c_str());
}

StatusBar::~StatusBar() { lv_obj_delete(root_); }

void StatusBar::Render() {}

}  // namespace oww::ui