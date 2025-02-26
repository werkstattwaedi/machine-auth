#include "statusbar.h"

namespace oww::ui {

StatusBar::StatusBar(lv_obj_t* parent, std::shared_ptr<oww::state::State> state)
    : Component(state) {
  root_ = lv_obj_create(parent);
  lv_obj_set_style_bg_color(root_, lv_color_hex(0xdddddd), LV_PART_MAIN);
}

StatusBar::~StatusBar() { lv_obj_delete(root_); }

void StatusBar::Render() {}

}  // namespace oww::ui