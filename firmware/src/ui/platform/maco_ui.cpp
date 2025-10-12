#include "ui/platform/maco_ui.h"

#include "drivers/maco_watchdog.h"
#include "drivers/display/ili9341.h"
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
  // Cast to interface for UI components
  std::shared_ptr<oww::state::IApplicationState> app_state =
      std::static_pointer_cast<oww::state::IApplicationState>(app_);
  ui_manager_ = std::make_unique<UiManager>(app_state);

  pinMode(buzzer::pin_pwm, OUTPUT);
  analogWrite(config::ui::display::pin_backlight, 255);

  led_strip_.show();
  // LED controller setup
  led_ = std::make_unique<drivers::leds::LedController>(&led_strip_);
  led_->InitializeDefaultMapping();

  // Hardware abstraction setup
  hardware_ = std::make_unique<hal::MacoHardware>(&led_strip_);

  drivers::display::Display::instance().Begin();

  os_mutex_create(&mutex_);

  thread_ = new Thread(
      "UserInterface", [this]() { UserInterfaceThread(); }, thread_priority,
      thread_stack_size);

  return {};
}

os_thread_return_t UserInterface::UserInterfaceThread() {
  auto display = &drivers::display::Display::instance();

  std::shared_ptr<oww::state::IApplicationState> app_state =
      std::static_pointer_cast<oww::state::IApplicationState>(app_);
  splash_screen_ = std::make_unique<SplashScreen>(app_state, hardware_.get());

  while (true) {
    drivers::MacoWatchdog::instance().Ping(drivers::ObservedThread::kUi);
    UpdateGui();
    UpdateBuzzer();
    UpdateLed();
    display->RenderLoop();
  }
}

void UserInterface::UpdateGui() {
  if (splash_screen_) {
    splash_screen_->Render();

    // Check if boot is complete (system is Ready)
    auto system_state = app_->GetSystemState();
    if (!std::holds_alternative<state::system::Ready>(*system_state)) {
      return;
    }

    splash_screen_ = nullptr;

    // Get machine label from configuration
    auto configuration = app_->GetConfiguration();
    std::string machine_label = configuration->IsConfigured()
                                    ? configuration->GetDeviceConfig()
                                          ->machines()
                                          ->begin()
                                          ->label()
                                          ->c_str()
                                    : "unconfigured";

    std::shared_ptr<oww::state::IApplicationState> app_state =
        std::static_pointer_cast<oww::state::IApplicationState>(app_);
    status_bar_ =
        std::make_unique<StatusBar>(lv_screen_active(), app_state, machine_label);

    // StatusBar: 240×58px (full width, 58px height)
    lv_obj_set_size(*status_bar_, 240, 58);
    lv_obj_align(*status_bar_, LV_ALIGN_TOP_LEFT, 0, 0);

    // Create button bar at the bottom
    button_bar_ = std::make_unique<ButtonBar>(lv_screen_active(), app_state,
                                               hardware_.get());
    ui_manager_->SetButtonBar(button_bar_.get());

    // Create main content area between status bar and button bar
    lv_obj_t* content_container = lv_obj_create(lv_screen_active());
    lv_obj_remove_style_all(content_container);
    // Main content: 240×212px (320 - 58 statusbar - 50 buttonbar = 212px
    // height)
    lv_obj_set_size(content_container, 240, 212);
    lv_obj_align(content_container, LV_ALIGN_TOP_LEFT, 0, 58);

    // Create and activate session status as main content
    session_status_ = std::make_shared<SessionStatus>(content_container, app_state,
                                                       hardware_.get());
    ui_manager_->PushContent(session_status_);

    // Set up button mappings for touch input
    SetupButtonMappings();
  }

  status_bar_->Render();
  button_bar_->Render();
  auto current_content = ui_manager_->GetCurrentContent();
  if (current_content) {
    current_content->Render();
  }
}

void UserInterface::UpdateBuzzer() {
  // TODO: Implement buzzer feedback based on new state system
}

void UserInterface::UpdateLed() {
  // TODO: Implement LED effects based on new state system
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
