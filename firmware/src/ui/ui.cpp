#include "ui.h"

#include "drivers/display/ili9341.h"

namespace oww::ui {
using namespace config::ui;
using namespace config;

Logger UserInterface::logger("app.ui");

UserInterface* UserInterface::instance_;

UserInterface& UserInterface::instance() {
  if (!instance_) {
    instance_ = new UserInterface();
  }
  return *instance_;
}

UserInterface::UserInterface()
    : led_strip_(config::led::pixel_count, SPI, config::led::pixel_type) {}

UserInterface::~UserInterface() {}

tl::expected<void, Error> UserInterface::Begin(
    std::shared_ptr<oww::logic::Application> state) {
  if (thread_ != nullptr) {
    logger.error("UserInterface::Begin() Already initialized");
    return tl::unexpected(Error::kIllegalState);
  }

  app_ = state;

  pinMode(buzzer::pin_pwm, OUTPUT);
  analogWrite(config::ui::display::pin_backlight, 255);

  led_strip_.show();
  // LED controller setup
  led_ = std::make_unique<drivers::leds::LedController>(&led_strip_);
  led_->InitializeDefaultMapping();

  drivers::display::Display::instance().Begin();

  os_mutex_create(&mutex_);

  thread_ = new Thread(
      "UserInterface", [this]() { UserInterfaceThread(); }, thread_priority,
      thread_stack_size);

  return {};
}

os_thread_return_t UserInterface::UserInterfaceThread() {
  auto display = &drivers::display::Display::instance();

  splash_screen_ = std::make_unique<SplashScreen>(app_);

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
    if (!app_->IsBootCompleted()) {
      return;
    }

    splash_screen_ = nullptr;
    status_bar_ = std::make_unique<StatusBar>(lv_screen_active(), app_);

    // StatusBar: 240×58px (full width, 58px height)
    lv_obj_set_size(*status_bar_, 240, 58);
    lv_obj_align(*status_bar_, LV_ALIGN_TOP_LEFT, 0, 0);

    // Create button bar at the bottom
    button_bar_ = std::make_unique<ButtonBar>(lv_screen_active(), app_);

    // Create main content area between status bar and button bar
    lv_obj_t* content_container = lv_obj_create(lv_screen_active());
    lv_obj_remove_style_all(content_container);
    // Main content: 240×212px (320 - 58 statusbar - 50 buttonbar = 212px
    // height)
    lv_obj_set_size(content_container, 240, 212);
    lv_obj_align(content_container, LV_ALIGN_TOP_LEFT, 0, 58);

    // Create and activate session status as main content
    session_status_ =
        std::make_shared<SessionStatus>(content_container, app_, this);
    PushContent(session_status_);

    // Set up button mappings for touch input
    SetupButtonMappings();
  }

  status_bar_->Render();
  button_bar_->Render();
  auto current_content = GetCurrentContent();
  if (current_content) {
    current_content->Render();
  }
}

void UserInterface::UpdateBuzzer() {
  // auto current_state = app_->GetTagState();

  // if (last_buzz_state_id_ != static_cast<void *>(current_state.get())) {
  //   using namespace oww::logic::tag;

  //   int frequency = 0;
  //   int duration = 100;

  //   std::visit(overloaded{
  //                  [&](Idle state) {},
  //                  [&](Detected state) { frequency = 440; },
  //                  [&](Authenticated state) {
  //                    frequency = 660;
  //                    duration = 200;
  //                  },
  //                  [&](Unknown state) {
  //                    frequency = 370;
  //                    duration = 200;
  //                  },

  //              },
  //              *(current_state.get()));

  //   if (frequency > 0) {
  //     analogWrite(buzzer::pin_pwm, 128, frequency);
  //     buzz_timeout = millis() + duration;
  //   }

  //   last_buzz_state_id_ = static_cast<void *>(current_state.get());
  // }

  // if (buzz_timeout != CONCURRENT_WAIT_FOREVER && buzz_timeout < millis()) {
  //   analogWrite(buzzer::pin_pwm, 0);
  //   buzz_timeout = CONCURRENT_WAIT_FOREVER;
  // }
}

// Helper function to convert HSL to RGB
void HslToRgb(float h, float s, float l, byte& r, byte& g, byte& b) {
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
  // auto current_state = app_->GetTagState();

  // using namespace oww::logic::tag;

  // // Choose effects/colors for each section based on state
  // using leds::Color;
  // using leds::EffectConfig;
  // using leds::EffectType;

  // EffectConfig ring, buttons, nfc;
  // leds::ButtonColors btn_colors;

  // std::visit(
  //     overloaded{
  //         [&](Idle state) {
  //           // Idle: soft blue breathe on ring and dim warm white NFC
  //           ring.type = EffectType::Breathe;
  //           ring.color = Color::RGB(0, 64, 200);
  //           ring.min_brightness = 8;
  //           ring.max_brightness = 64;
  //           ring.period_ms = 3000;

  //           nfc.type = EffectType::Solid;
  //           nfc.color = Color::WarmWhite(24);

  //           buttons.type = EffectType::Solid;
  //           btn_colors = {Color::RGB(32, 32, 32), Color::RGB(32, 32, 32),
  //                         Color::RGB(32, 32, 32), Color::RGB(32, 32, 32)};
  //         },
  //         [&](Detected state) {
  //           // Tag detected: rotate yellow highlight on ring
  //           ring.type = EffectType::Rotate;
  //           ring.color = Color::RGB(200, 160, 20);
  //           ring.lit_pixels = 20;  // ~2x nominal width
  //           ring.hotspots = 2;     // opposite sides
  //           ring.period_ms = 1500;

  //           nfc.type = EffectType::Breathe;
  //           nfc.color = Color::RGB(0, 80, 220);

  //           buttons.type = EffectType::Solid;
  //           btn_colors = {Color::RGB(60, 60, 20), Color::RGB(60, 60, 20),
  //                         Color::RGB(60, 60, 20), Color::RGB(60, 60, 20)};
  //         },
  //         [&](Authenticated state) {
  //           // Green steady ring, NFC short breathe pulse
  //           ring.type = EffectType::Solid;
  //           ring.color = Color::RGB(0, 180, 40);
  //           nfc.type = EffectType::Breathe;
  //           nfc.color = Color::RGB(0, 120, 40);

  //           buttons.type = EffectType::Solid;
  //           btn_colors = {Color::RGB(40, 120, 40), Color::RGB(40, 120, 40),
  //                         Color::RGB(40, 120, 40), Color::RGB(40, 120, 40)};
  //         },
  //         [&](Unknown state) {
  //           // Access denied: red blink all around, red NFC
  //           ring.type = EffectType::Blink;
  //           ring.color = Color::RGB(200, 20, 20);
  //           ring.period_ms = 700;
  //           ring.duty_cycle = 160;
  //           nfc.type = EffectType::Solid;
  //           nfc.color = Color::RGB(120, 0, 0);
  //           buttons.type = EffectType::Solid;
  //           btn_colors = {Color::RGB(120, 20, 20), Color::RGB(120, 20, 20),
  //                         Color::RGB(120, 20, 20), Color::RGB(120, 20, 20)};
  //         },
  //     },
  //     *(current_state.get()));

  // // Apply configs (ring and NFC always from UI state)
  // led_->Ring().SetEffect(ring);
  // led_->Nfc().SetEffect(nfc);

  // // Buttons: if current content has a definition, ButtonBar drives LEDs in
  // its
  // // Render(); otherwise, fall back to generic state colors here.
  // auto active = GetCurrentContent();
  // bool has_buttons = active && active->GetButtonDefinition();
  // if (!has_buttons) {
  //   led_->Buttons().SetEffect(buttons);
  //   led_->Buttons().SetColors(btn_colors);
  // }

  // // Tick renderer
  // led_->Tick(millis());
}

void UserInterface::SetupButtonMappings() {
  auto& display = drivers::display::Display::instance();

  // Map physical buttons to UI positions using static coordinates
  // Physical button mapping:
  // 0: lower right  -> right button in ButtonBar
  // 4: lower left   -> left button in ButtonBar
  // 3: top left     -> UP button (invisible left area)
  // 1: top right    -> DOWN button (invisible right area)

  // Use static coordinates from ButtonBar for reliable positioning
  display.SetButtonMapping(4, bottom_left_touch_point);
  display.SetButtonMapping(0, bottom_right_touch_point);
  display.SetButtonMapping(3, top_left_touch_point);
  display.SetButtonMapping(1, top_right_touch_point);
}

void UserInterface::PushContent(std::shared_ptr<MainContent> content) {
  if (!content_stack_.empty()) {
    content_stack_.back()->OnDeactivate();
    if (button_bar_ && content_stack_.back()->GetButtonDefinition()) {
      button_bar_->RemoveButtons(content_stack_.back()->GetButtonDefinition());
    }
  }

  content_stack_.push_back(content);
  ActivateContent(content);
}

void UserInterface::PopContent() {
  if (content_stack_.size() <= 1) {
    return;  // Don't pop the last content
  }

  auto current = content_stack_.back();
  current->OnDeactivate();
  if (button_bar_ && current->GetButtonDefinition()) {
    button_bar_->RemoveButtons(current->GetButtonDefinition());
  }

  content_stack_.pop_back();

  if (!content_stack_.empty()) {
    ActivateContent(content_stack_.back());
  }
}

std::shared_ptr<MainContent> UserInterface::GetCurrentContent() {
  if (content_stack_.empty()) {
    return nullptr;
  }
  return content_stack_.back();
}

void UserInterface::ActivateContent(std::shared_ptr<MainContent> content) {
  content->OnActivate();
  if (button_bar_ && content->GetButtonDefinition()) {
    button_bar_->ActivateButtons(content->GetButtonDefinition());
  }
}

void UserInterface::DeactivateCurrentContent() {
  if (!content_stack_.empty()) {
    auto current = content_stack_.back();
    current->OnDeactivate();
    if (button_bar_ && current->GetButtonDefinition()) {
      button_bar_->RemoveButtons(current->GetButtonDefinition());
    }
  }
}

}  // namespace oww::ui
