#pragma once

#include <lvgl.h>

class StressTest {
 public:
  static void CreateWidget(lv_obj_t* parent = nullptr);
  static void Start();
  static void Stop();
  
 private:
  static lv_obj_t* container_;
  static lv_obj_t* moving_rect_;
  static lv_obj_t* color_bars_[8];
  static lv_obj_t* gradient_rect_;
  static lv_timer_t* animation_timer_;
  
  static void AnimationCallback(lv_timer_t* timer);
  static uint32_t frame_counter_;
  static uint32_t start_time_;
};
