#pragma once

// Adds extra logging during development
#if !defined(DEVELOPMENT_BUILD)
#define DEVELOPMENT_BUILD 1
#endif

// #define REMOTE_LOGGING 0

#include "neopixel.h"

enum Ntag424Key : byte;

namespace config {

namespace ui {

constexpr os_thread_prio_t thread_priority = OS_THREAD_PRIORITY_DEFAULT;
// Stack size is recommended to be 8k+
// https:  // docs.lvgl.io/master/intro/introduction.html#requirements
constexpr size_t thread_stack_size = 8 * 1024;

namespace display {

constexpr auto resolution_horizontal = 240;
constexpr auto resolution_vertical = 320;

constexpr int8_t pin_reset = S3;  // aka SS, D18. Not controlled by the LED SPI.
constexpr int8_t pin_chipselect = D5;
constexpr int8_t pin_datacommand = D10;
constexpr int8_t pin_backlight = A5;
constexpr int8_t pin_touch_chipselect = D7;
constexpr int8_t pin_touch_irq = D19;

// Display flush thread
constexpr os_thread_prio_t thread_priority = OS_THREAD_PRIORITY_DEFAULT + 1;
}  // namespace display

namespace touch {

constexpr int8_t pin_irq = D11;  // aka A0

}  // namespace touch

}  // namespace ui

namespace buzzer {
constexpr int8_t pin_pwm = A2;
}  // namespace buzzer

namespace led {
// NOTE: the LEDs use the MOSI pin of SPI1 interface. This conflicts with other
//   uses of the MOSI and SCK pins

constexpr uint8_t pixel_count = 16;
constexpr uint8_t pixel_type = IN4818;

// Super high priority for LED rendering, since its little work, and the
// fluidity depends on it
constexpr os_thread_prio_t thread_priority = OS_THREAD_PRIORITY_CRITICAL - 1;
constexpr size_t thread_stack_size = 2048;

constexpr auto target_frame_time =
    std::chrono::milliseconds(1000 / 30);  // 30fps

}  // namespace led

namespace nfc {
// NOTE: S1 is also affected by the LED strip. Always lock the SPI1
// interface before working with the pin!
constexpr int8_t pin_reset = S1;  // aka MISO, D16

// Bump priority of NFC thread, since UART requests must be answererd promptly
constexpr os_thread_prio_t thread_priority = OS_THREAD_PRIORITY_DEFAULT;
constexpr size_t thread_stack_size = OS_THREAD_STACK_SIZE_DEFAULT_HIGH;
}  // namespace nfc

namespace ext {

constexpr int8_t pin_relais = A1;
// NOTE: S1 is also affected by the LED strip. Always lock the SPI1
// interface before working with the pin!
constexpr int8_t pin_i2c_enable = S2;  // aka SCK, D17
constexpr int8_t pin_irq = D6;

}  // namespace ext

namespace tag {

constexpr Ntag424Key key_application{0};
constexpr Ntag424Key key_terminal{1};
constexpr Ntag424Key key_authorization{2};
constexpr Ntag424Key key_reserved_1{3};
constexpr Ntag424Key key_reserved_2{4};

}  // namespace tag

}  // namespace config