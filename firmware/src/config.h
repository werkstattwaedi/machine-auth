#pragma once

// Adds extra logging during development
#if !defined(DEVELOPMENT_BUILD)
#define DEVELOPMENT_BUILD 1
#endif

#include "neopixel.h"

enum Ntag424Key : byte;

namespace config {

namespace ui {

constexpr os_thread_prio_t thread_priority = 3;
// Stack size is recommended to be 8k+
// https:  // docs.lvgl.io/master/intro/introduction.html#requirements
constexpr size_t thread_stack_size = 8 * 1024;

namespace display {

constexpr auto resolution_horizontal = 240;
constexpr auto resolution_vertical = 320;

constexpr int8_t pin_reset = D6;
constexpr int8_t pin_chipselect = D5;
constexpr int8_t pin_datacommand = D10;
constexpr int8_t pin_backlight = A5;
constexpr int8_t pin_touch_chipselect = S3;
constexpr int8_t pin_touch_irq = S4;
}  // namespace display

}  // namespace ui

namespace buzzer {
constexpr int8_t pin_pwm = A2;
}  // namespace buzzer

namespace led {
constexpr uint8_t pixel_count = 16;
constexpr uint8_t pixel_type = WS2812B;
}  // namespace led

namespace nfc {

constexpr int8_t pin_reset = D12;

constexpr os_thread_prio_t thread_priority = OS_THREAD_PRIORITY_DEFAULT;
constexpr size_t thread_stack_size = OS_THREAD_STACK_SIZE_DEFAULT_HIGH;

}  // namespace nfc

namespace tag {

constexpr Ntag424Key key_application{0};
constexpr Ntag424Key key_terminal{1};
constexpr Ntag424Key key_authorization{2};
constexpr Ntag424Key key_reserved_1{3};
constexpr Ntag424Key key_reserved_2{4};

}  // namespace tag

}  // namespace config