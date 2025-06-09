#include "splashscreen.h"

LV_IMG_DECLARE(oww_logo);

namespace oww::ui {

SplashScreen::SplashScreen(std::shared_ptr<oww::state::State> state)
    : Component(state) {
  lv_obj_set_style_bg_color(lv_screen_active(), lv_color_white(), LV_PART_MAIN);

  root_ = lv_obj_create(lv_screen_active());
  lv_obj_set_size(root_, 240, 320);
  lv_obj_align(root_, LV_ALIGN_TOP_LEFT, 0, 0);

  static lv_style_t style;
  lv_style_init(&style);
  lv_style_set_radius(&style, 5);

  auto logo = lv_image_create(root_);

  lv_image_set_src(logo, &oww_logo);

  // lv_obj_set_size(root_, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_align(logo, LV_ALIGN_CENTER, 0, 0);
   
};
SplashScreen::~SplashScreen() {
  // lv_obj_delete(image_);
  lv_obj_delete(root_);
}

void SplashScreen::Render() {}

}  // namespace oww::ui