#include "ui.h"

#include "../state/configuration.h"
#include "driver/display.h"

namespace oww::ui {
using namespace config::ui;
using namespace config;

Logger UserInterface::logger("ui");

UserInterface *UserInterface::instance_;

UserInterface &UserInterface::instance() {
  if (!instance_) {
    instance_ = new UserInterface();
  }
  return *instance_;
}

UserInterface::UserInterface()
    : led_strip_(config::led::pixel_count, SPI, config::led::pixel_type) {}

UserInterface::~UserInterface() {}

tl::expected<void, Error> UserInterface::Begin(
    std::shared_ptr<oww::state::State> state) {
  if (thread_ != nullptr) {
    logger.error("UserInterface::Begin() Already initialized");
    return tl::unexpected(Error::kIllegalState);
  }

  state_ = state;

  pinMode(buzzer::pin_pwm, OUTPUT);
  analogWrite(config::ui::display::pin_backlight, 255);

  led_strip_.begin();
  led_strip_.show();

  Display::instance().Begin();

  os_mutex_create(&mutex_);

  thread_ = new Thread(
      "UserInterface", [this]() { UserInterfaceThread(); }, thread_priority,
      thread_stack_size);

  return {};
}

os_thread_return_t UserInterface::UserInterfaceThread() {
  auto display = &Display::instance();

  splash_screen_ = std::make_unique<SplashScreen>(state_);

  while (true) {
    UpdateGui();
    UpdateBuzzer();
    UpdateLed();
    display->RenderLoop();
  }
}

void UserInterface::UpdateGui() {
  if (splash_screen_) {
    splash_screen_->Render();
    if (!state_->IsBootCompleted()) {
      return;
    }

    splash_screen_ = nullptr;
    status_bar_ = std::make_unique<StatusBar>(lv_screen_active(), state_);

    lv_obj_set_size(*status_bar_, lv_pct(100), 50);
    lv_obj_align(*status_bar_, LV_ALIGN_TOP_LEFT, 0, 0);

    tag_status_ = std::make_unique<TagStatus>(lv_screen_active(), state_);

    lv_obj_set_size(*tag_status_, lv_pct(100), 100);
    lv_obj_align(*tag_status_, LV_ALIGN_TOP_LEFT, 0, 50);
  }
  if (status_bar_) {
    status_bar_->Render();
  }
  if (tag_status_) {
    tag_status_->Render();
  }
}

void UserInterface::UpdateBuzzer() {
  auto current_state = state_->GetTerminalState();

  if (last_buzz_state_id_ != static_cast<void *>(current_state.get())) {
    using namespace oww::state::terminal;

    int frequency = 0;
    int duration = 100;

    std::visit(overloaded{
                   [&](Idle state) {},
                   [&](Detected state) { frequency = 440; },
                   [&](Authenticated state) {
                     frequency = 660;
                     duration = 200;
                   },
                   [&](StartSession state) {},
                   [&](Unknown state) {
                     frequency = 370;
                     duration = 200;
                   },
                   [&](Personalize state) {},

               },
               *(current_state.get()));

    if (frequency > 0) {
      analogWrite(buzzer::pin_pwm, 128, frequency);
      buzz_timeout = millis() + duration;
    }

    last_buzz_state_id_ = static_cast<void *>(current_state.get());
  }

  if (buzz_timeout != CONCURRENT_WAIT_FOREVER && buzz_timeout < millis()) {
    analogWrite(buzzer::pin_pwm, 0);
    buzz_timeout = CONCURRENT_WAIT_FOREVER;
  }
}

// Helper function to convert HSL to RGB
void HslToRgb(float h, float s, float l, byte &r, byte &g, byte &b) {
  if (s == 0) {
    r = g = b = (byte)(l * 255.0f);
  } else {
    auto hue2rgb = [](float p, float q, float t) {
      if (t < 0.0f) t += 1.0f;
      if (t > 1.0f) t -= 1.0f;
      if (t < 1.0f / 6.0f) return p + (q - p) * 6.0f * t;
      if (t < 1.0f / 2.0f) return q;
      if (t < 2.0f / 3.0f) return p + (q - p) * (2.0f / 3.0f - t) * 6.0f;
      return p;
    };

    float q = l < 0.5f ? l * (1.0f + s) : l + s - l * s;
    float p = 2.0f * l - q;
    r = (byte)(hue2rgb(p, q, h + 1.0f / 3.0f) * 255.0f);
    g = (byte)(hue2rgb(p, q, h) * 255.0f);
    b = (byte)(hue2rgb(p, q, h - 1.0f / 3.0f) * 255.0f);
  }
}

void UserInterface::UpdateLed() {
  auto current_state = state_->GetTerminalState();

  using namespace oww::state::terminal;

  byte r = 0;
  byte g = 0;
  byte b = 0;

  std::visit(overloaded{
                 [&](Idle state) { b = 255; },  // Blue
                 [&](Detected state) {
                   r = 255;
                   g = 255;
                 },                                      // Yellow
                 [&](Authenticated state) { g = 255; },  // Green
                 [&](StartSession state) {
                   g = 255;
                   b = 255;
                 },                                // Cyan
                 [&](Unknown state) { r = 255; },  // Red
                 [&](Personalize state) {
                   r = 255;
                   b = 255;
                 },  // Magenta

             },
             *(current_state.get()));

  byte scaling = 20;  // sin((millis() / 5000.0) * TWO_PI) * 15 + 20;
  for (size_t i = 0; i < led_strip_.numPixels(); i++) {
    led_strip_.setColorScaled(i, r, g, b, scaling);
  }

  // Dicso test
  // byte scaling = sin((millis() / 10000.0) * TWO_PI) * 100 + 150;
  // float hue_offset = fmod((millis() / 2000.0f), 1.0f);  // Cycle every 5
  // seconds

  // for (size_t i = 0; i < led_strip_.numPixels(); i++) {
  //   float pixel_hue =
  //       fmod(hue_offset + (float)i / led_strip_.numPixels(), 1.0f);
  //   byte pixel_r, pixel_g, pixel_b;
  //   HslToRgb(pixel_hue, 1.0f, 0.5f, pixel_r, pixel_g, pixel_b);
  //   led_strip_.setColorScaled(i, pixel_r, pixel_g, pixel_b, scaling);
  // }

  led_strip_.show();
}

}  // namespace oww::ui
