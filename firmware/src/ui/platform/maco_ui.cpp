#include "ui/platform/maco_ui.h"

#include "common/time.h"
#include "drivers/display/ili9341.h"
#include "drivers/maco_watchdog.h"
#include "hal/led_effect.h"
#include "state/system_state.h"

namespace oww::ui {
using namespace config::ui;
using namespace config;

Logger MacoUI::logger("app.ui");

MacoUI* MacoUI::instance_;

MacoUI& MacoUI::instance() {
  if (!instance_) {
    instance_ = new MacoUI();
  }
  return *instance_;
}

MacoUI::MacoUI()
    : led_strip_(config::led::pixel_count, SPI, config::led::pixel_type) {
  // Initialize LED strip
  led_strip_.show();
}

MacoUI::~MacoUI() {
  // Clean up threads
  if (led_thread_) {
    delete led_thread_;
    led_thread_ = nullptr;
  }
  if (ui_thread_) {
    delete ui_thread_;
    ui_thread_ = nullptr;
  }
}

tl::expected<void, ErrorType> MacoUI::Begin(
    std::shared_ptr<oww::logic::Application> state) {
  if (ui_thread_ != nullptr) {
    logger.error("MacoUI::Begin() Already initialized");
    return tl::unexpected(ErrorType::kUnexpectedState);
  }

  app_ = state;

  pinMode(buzzer::pin_pwm, OUTPUT);
  analogWrite(config::ui::display::pin_backlight, 255);

  // Initialize display BEFORE creating UI components
  auto& display = drivers::display::Display::instance();
  display.Begin();

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

  // Get machine label from configuration
  auto configuration = app_->GetConfiguration();
  std::string machine_label = configuration->IsConfigured()
                                  ? configuration->GetDeviceConfig()
                                        ->machines()
                                        ->begin()
                                        ->label()
                                        ->c_str()
                                  : "unconfigured";

  // Cast to interface for UI components
  std::shared_ptr<oww::state::IApplicationState> app_state =
      std::static_pointer_cast<oww::state::IApplicationState>(app_);
  // Create UI manager (pass this as IHardware*)
  ui_manager_ = std::make_unique<UiManager>(app_state, this, lv_screen_active(),
                                            machine_label);

  ui_thread_ = new Thread(
      "UserInterface", [this]() { UserInterfaceThread(); }, thread_priority,
      thread_stack_size);

  // Start LED thread
  led_thread_ = new Thread(
      "LEDs", [this]() { return LedThread(); }, config::led::thread_priority,
      config::led::thread_stack_size);

  return {};
}

os_thread_return_t MacoUI::UserInterfaceThread() {
  auto display = &drivers::display::Display::instance();

  while (true) {
    drivers::MacoWatchdog::instance().Ping(drivers::ObservedThread::kUi);
    ui_manager_->Loop();
    display->RenderLoop();
  }
}

// IHardware interface implementation
void MacoUI::SetLedEffect(std::shared_ptr<hal::ILedEffect> led_effect) {
  led_effect_ = led_effect;
}

void MacoUI::Beep(uint16_t frequency_hz, uint16_t duration_ms) {
  // TODO: Implement buzzer control
}

os_thread_return_t MacoUI::LedThread() {
  while (true) {
    auto frame_start = timeSinceBoot();

    // Ping watchdog
    drivers::MacoWatchdog::instance().Ping(drivers::ObservedThread::kLed);

    // Render all LEDs using callback
    if (!led_effect_) {
      delay(config::led::target_frame_time);
      continue;
    }
    auto colors = led_effect_->GetLeds(frame_start);
    for (uint8_t i = 0; i < config::led::pixel_count && i < colors.size();
         i++) {
      auto color = colors[i];
      if (color.unspecified) continue;
      led_strip_.setPixelColor(i, color.r, color.g, color.b, color.w);
    }

    // Note: calling show on the LEDs takes roghly 5ms
    led_strip_.show();

    // Maintain frame rate
    auto frame_end = timeSinceBoot();
    auto frame_duration = std::chrono::duration_cast<std::chrono::milliseconds>(
        frame_end - frame_start);
    auto sleep_time = config::led::target_frame_time - frame_duration;

    if (sleep_time > std::chrono::milliseconds(0)) {
      delay(sleep_time);
    }
  }
}

}  // namespace oww::ui
