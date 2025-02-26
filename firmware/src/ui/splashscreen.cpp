#include "splashscreen.h"

namespace oww::ui {

SplashScreen::SplashScreen(std::shared_ptr<oww::state::State> state)
    : Component(state) {
  lv_obj_set_style_bg_color(lv_screen_active(), lv_color_white(), LV_PART_MAIN);

  image_ = lv_image_create(lv_screen_active());
  lv_obj_align(image_, LV_ALIGN_LEFT_MID, 10, 0);
};
SplashScreen::~SplashScreen() { lv_obj_delete(image_); }

void SplashScreen::Render() {}

}  // namespace oww::ui