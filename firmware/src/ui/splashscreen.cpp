#include "splashscreen.h"

namespace oww::ui {

SplashScreen::SplashScreen(std::shared_ptr<oww::state::State> state)
    : Component(state) {
  lv_obj_set_style_bg_color(lv_screen_active(), lv_color_white(), LV_PART_MAIN);


  root_ = lv_obj_create(lv_screen_active());
  lv_obj_set_size(root_, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_align(root_, LV_ALIGN_TOP_LEFT, 0, 0);
  

  static lv_style_t style;
  lv_style_init(&style);
  lv_style_set_radius(&style, 5);

  /*Make a gradient*/
  lv_style_set_bg_opa(&style, LV_OPA_COVER);
  static lv_grad_dsc_t grad;
  grad.dir = LV_GRAD_DIR_VER;
  grad.stops_count = 2;
  grad.stops[0].color = lv_color_black();
  grad.stops[0].opa = LV_OPA_COVER;
  grad.stops[1].color =lv_color_make(255, 0,0);
  grad.stops[1].opa = LV_OPA_COVER;

  /*Shift the gradient to the bottom*/
  grad.stops[0].frac  = 0;
  grad.stops[1].frac  = 255;

  lv_style_set_bg_grad(&style, &grad);

  auto red = lv_obj_create(root_);
  lv_obj_add_style(red, &style, 0);

  // lv_obj_set_style_bg_color(red, lv_color_make(200, 0,0), LV_PART_MAIN);
  lv_obj_set_size(red, 50, 300);
  lv_obj_align(red, LV_ALIGN_TOP_LEFT, 0, 0);

  auto green = lv_obj_create(root_);
  lv_obj_set_style_bg_color(green, lv_color_make(0, 200,0), LV_PART_MAIN);
  lv_obj_set_size(green, 50, 50);
  lv_obj_align(green, LV_ALIGN_TOP_LEFT, 50, 0);

  auto blue = lv_obj_create(root_);
  lv_obj_set_style_bg_color(blue, lv_color_make(0, 0,200) , LV_PART_MAIN);
  lv_obj_set_size(blue, 50, 50);
  lv_obj_align(blue, LV_ALIGN_TOP_LEFT, 100, 0);

  auto black = lv_obj_create(root_);
  lv_obj_set_style_bg_color(black, lv_color_black() , LV_PART_MAIN);
  lv_obj_set_size(black, 50, 50);
  lv_obj_align(black, LV_ALIGN_TOP_LEFT, 150, 0);

  auto white = lv_obj_create(root_);
  lv_obj_set_style_bg_color(white, lv_color_white(), LV_PART_MAIN);
  lv_obj_set_size(white, 50, 50);
  lv_obj_align(white, LV_ALIGN_TOP_LEFT, 200, 0);


  // image_ = lv_image_create(lv_screen_active());
  // lv_obj_align(image_, LV_ALIGN_LEFT_MID, 50, 0);
};
SplashScreen::~SplashScreen() { 
  // lv_obj_delete(image_); 
}

void SplashScreen::Render() {}

}  // namespace oww::ui