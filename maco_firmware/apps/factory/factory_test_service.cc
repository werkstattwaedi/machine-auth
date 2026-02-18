// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "FACTORY"

#include "maco_firmware/apps/factory/factory_test_service.h"

#include <chrono>
#include <iterator>

#include "lvgl.h"
#include "pw_chrono/system_clock.h"
#include "pw_log/log.h"
#include "pw_string/string_builder.h"
#include "pw_thread/sleep.h"

namespace maco::factory {
namespace {

void SetOk(maco_factory_TestResponse& response, const char* msg = "OK") {
  response.success = true;
  pw::StringBuilder(response.message) << msg;
}

void SetError(maco_factory_TestResponse& response, const char* msg) {
  response.success = false;
  pw::StringBuilder(response.message) << msg;
}

}  // namespace

pw::Status FactoryTestService::LedSetAll(
    const ::maco_factory_LedColorRequest& request,
    ::maco_factory_TestResponse& response) {
  led_ops_.fill(static_cast<uint8_t>(request.r),
                static_cast<uint8_t>(request.g),
                static_cast<uint8_t>(request.b),
                static_cast<uint8_t>(request.w));
  PW_LOG_INFO("LED SetAll: r=%d g=%d b=%d w=%d",
              static_cast<int>(request.r), static_cast<int>(request.g),
              static_cast<int>(request.b), static_cast<int>(request.w));
  SetOk(response);
  return pw::OkStatus();
}

pw::Status FactoryTestService::LedSetPixel(
    const ::maco_factory_LedPixelRequest& request,
    ::maco_factory_TestResponse& response) {
  if (request.index >= led_ops_.led_count) {
    SetError(response, "Index out of range");
    return pw::OkStatus();
  }
  led_ops_.set_pixel(static_cast<uint16_t>(request.index),
                     static_cast<uint8_t>(request.r),
                     static_cast<uint8_t>(request.g),
                     static_cast<uint8_t>(request.b),
                     static_cast<uint8_t>(request.w));
  PW_LOG_INFO("LED SetPixel[%d]: r=%d g=%d b=%d w=%d",
              static_cast<int>(request.index),
              static_cast<int>(request.r), static_cast<int>(request.g),
              static_cast<int>(request.b), static_cast<int>(request.w));
  SetOk(response);
  return pw::OkStatus();
}

pw::Status FactoryTestService::LedClear(
    const ::maco_factory_Empty& /*request*/,
    ::maco_factory_TestResponse& response) {
  led_ops_.clear();
  PW_LOG_INFO("LED Clear");
  SetOk(response);
  return pw::OkStatus();
}

pw::Status FactoryTestService::DisplaySetBrightness(
    const ::maco_factory_BrightnessRequest& request,
    ::maco_factory_TestResponse& response) {
  PW_LOG_INFO("Display brightness: %d", static_cast<int>(request.brightness));
  SetOk(response, "Brightness logged");
  return pw::OkStatus();
}

pw::Status FactoryTestService::DisplayFillColor(
    const ::maco_factory_DisplayColorRequest& request,
    ::maco_factory_TestResponse& response) {
  lv_obj_t* screen = lv_screen_active();
  if (screen == nullptr) {
    SetError(response, "No active screen");
    return pw::OkStatus();
  }

  uint32_t hex = (request.r << 16) | (request.g << 8) | request.b;
  lv_obj_set_style_bg_color(screen, lv_color_hex(hex), LV_PART_MAIN);
  lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_invalidate(screen);

  PW_LOG_INFO("Display fill: #%06x", static_cast<unsigned>(hex));
  SetOk(response);
  return pw::OkStatus();
}

pw::Status FactoryTestService::DisplayColorBars(
    const ::maco_factory_Empty& /*request*/,
    ::maco_factory_TestResponse& response) {
  lv_obj_t* screen = lv_screen_active();
  if (screen == nullptr) {
    SetError(response, "No active screen");
    return pw::OkStatus();
  }

  // Clear existing children
  lv_obj_clean(screen);
  lv_obj_set_style_bg_color(screen, lv_color_black(), LV_PART_MAIN);
  lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_pad_all(screen, 0, LV_PART_MAIN);

  // Color bars: R, G, B, W, C, M, Y
  constexpr uint32_t kColors[] = {
      0xFF0000, 0x00FF00, 0x0000FF, 0xFFFFFF,
      0x00FFFF, 0xFF00FF, 0xFFFF00,
  };
  constexpr int kBarCount = std::size(kColors);
  int32_t screen_width = lv_obj_get_width(screen);
  int32_t screen_height = lv_obj_get_height(screen);
  int32_t bar_width = screen_width / kBarCount;

  for (int i = 0; i < kBarCount; ++i) {
    lv_obj_t* bar = lv_obj_create(screen);
    lv_obj_set_size(bar, bar_width, screen_height);
    lv_obj_set_pos(bar, i * bar_width, 0);
    lv_obj_set_style_bg_color(bar, lv_color_hex(kColors[i]), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_width(bar, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(bar, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(bar, 0, LV_PART_MAIN);
    lv_obj_remove_flag(bar, LV_OBJ_FLAG_SCROLLABLE);
  }

  lv_obj_invalidate(screen);
  PW_LOG_INFO("Display color bars shown");
  SetOk(response);
  return pw::OkStatus();
}

pw::Status FactoryTestService::BuzzerBeep(
    const ::maco_factory_BuzzerBeepRequest& request,
    ::maco_factory_TestResponse& response) {
  buzzer_.Beep(request.frequency_hz,
               std::chrono::milliseconds(request.duration_ms));
  PW_LOG_INFO("Buzzer beep: %u Hz, %u ms",
              static_cast<unsigned>(request.frequency_hz),
              static_cast<unsigned>(request.duration_ms));
  SetOk(response);
  return pw::OkStatus();
}

pw::Status FactoryTestService::BuzzerStop(
    const ::maco_factory_Empty& /*request*/,
    ::maco_factory_TestResponse& response) {
  buzzer_.Stop();
  PW_LOG_INFO("Buzzer stop");
  SetOk(response);
  return pw::OkStatus();
}

pw::Status FactoryTestService::TouchRead(
    const ::maco_factory_TouchReadRequest& request,
    ::maco_factory_TouchReadResponse& response) {
  using namespace std::chrono_literals;

  const auto timeout = std::chrono::milliseconds(request.timeout_ms);
  const auto deadline =
      pw::chrono::SystemClock::now() + std::chrono::duration_cast<
          pw::chrono::SystemClock::duration>(timeout);

  do {
    const uint8_t touched = touch_ops_.read_touched();
    if (touched != 0) {
      response.raw_bitmask = touched;
      response.button_ok = (touched & (1 << 0)) != 0;
      response.button_down = (touched & (1 << 1)) != 0;
      response.button_up = (touched & (1 << 3)) != 0;
      response.button_cancel = (touched & (1 << 4)) != 0;
      return pw::OkStatus();
    }

    if (request.timeout_ms == 0) {
      break;
    }

    pw::this_thread::sleep_for(50ms);
  } while (pw::chrono::SystemClock::now() < deadline);

  // Timeout with no touch
  response.raw_bitmask = 0;
  return pw::OkStatus();
}

}  // namespace maco::factory
