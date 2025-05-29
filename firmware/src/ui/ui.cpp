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
    if (millis() < 2000) {
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

  // logger.error("UpdateBuzzer");

  if (last_buzz_state_id_ != static_cast<void *>(current_state.get())) {
    using namespace oww::state::terminal;

    int frequency = 0;

    std::visit(overloaded{
                   [&](Idle state) {},
                   [&](Detected state) { frequency = 440; },
                   [&](Authenticated state) { frequency = 660; },
                   [&](StartSession state) {},
                   [&](Unknown state) { frequency = 370; },
                   [&](Personalize state) {},

               },
               *(current_state.get()));

    if (frequency > 0) {
      logger.error("Buzzing with frequency %d", frequency);

      analogWrite(buzzer::pin_pwm, 128, frequency);
      buzz_timeout = millis() + 2000;
    }

    last_buzz_state_id_ = static_cast<void *>(current_state.get());
  }

  if (buzz_timeout != CONCURRENT_WAIT_FOREVER && buzz_timeout < millis()) {
    logger.error("Stopping buzzer");

    analogWrite(buzzer::pin_pwm, 0, 0);
    buzz_timeout = CONCURRENT_WAIT_FOREVER;
  }
}

void UserInterface::UpdateLed() {}

}  // namespace oww::ui
