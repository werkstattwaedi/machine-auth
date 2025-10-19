#include "ui/components/screen.h"

namespace oww::ui {

Screen::Screen(lv_obj_t* parent,
               std::shared_ptr<state::IApplicationState> state,
               hal::IHardware* hardware)
    : Component(state, hardware) {
  root_ = lv_obj_create(parent);
  lv_obj_remove_style_all(root_);
  lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
  lv_obj_set_align(root_, LV_ALIGN_CENTER);
  lv_obj_add_flag(root_, LV_OBJ_FLAG_HIDDEN);
}

Screen::~Screen() { lv_obj_delete(root_); }

void Screen::OnActivate() { lv_obj_clear_flag(root_, LV_OBJ_FLAG_HIDDEN); }

void Screen::OnDeactivate() { lv_obj_add_flag(root_, LV_OBJ_FLAG_HIDDEN); }

void Screen::Render() {
  // Default implementation - subclasses should override
}

}  // namespace oww::ui
