#include "ui/platform/maco_ui.h"

#include "drivers/display/ili9341.h"
#include "drivers/maco_watchdog.h"
#include "state/system_state.h"

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

UserInterface::UserInterface() {}

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

  // Hardware abstraction setup
  hardware_ = std::make_unique<hal::MacoHardware>();

  // Initialize display BEFORE creating UI components
  drivers::display::Display::instance().Begin();

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
  // Create UI manager (will auto-create screens based on system state)
  ui_manager_ = std::make_unique<UiManager>(app_state, hardware_.get(),
                                            lv_screen_active(), machine_label);

  os_mutex_create(&mutex_);

  thread_ = new Thread(
      "UserInterface", [this]() { UserInterfaceThread(); }, thread_priority,
      thread_stack_size);

  return {};
}

os_thread_return_t UserInterface::UserInterfaceThread() {
  auto display = &drivers::display::Display::instance();

  // Set up button mappings once at start
  SetupButtonMappings();

  while (true) {
    drivers::MacoWatchdog::instance().Ping(drivers::ObservedThread::kUi);
    ui_manager_->Loop();
    display->RenderLoop();
  }
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

}  // namespace oww::ui
