#pragma once

#include <memory>
#include <vector>

#include "state/iapplication_state.h"
#include "ui/components/buttonbar.h"
#include "ui/components/screen.h"
#include "ui/components/statusbar.h"
#include "ui/leds/crossfade.h"
#include "ui/leds/multiplexer.h"
#include "hal/hardware_interface.h"

// Forward declarations
namespace oww::ui {
class SplashScreen;
}

namespace oww::ui {

/**
 * @brief Core UI manager handling content navigation and lifecycle
 *
 * Platform-independent UI orchestrator. Manages ALL UI components including
 * StatusBar, ButtonBar, and screen stack. Automatically creates screens based
 * on system state and handles transitions.
 */
class UiManager {
 public:
  /**
   * @param app Application state interface
   * @param hardware Hardware interface for LED control
   * @param root_screen LVGL root screen object (typically lv_screen_active())
   * @param machine_label Label for the machine (shown in status bar)
   */
  UiManager(std::shared_ptr<state::IApplicationState> app,
            hal::IHardware* hardware,
            lv_obj_t* root_screen,
            std::string machine_label = "Machine");
  virtual ~UiManager() = default;

  /** Push a new Screen onto the stack, making it active */
  void PushScreen(std::shared_ptr<Screen> screen);

  /** Pop the current Screen from the stack, returning to the previous one */
  void PopScreen();

  /** Get the currently active Screen */
  std::shared_ptr<Screen> GetCurrentScreen();

  /**
   * @brief Main update loop - call this every frame
   *
   * Handles:
   * - System state monitoring and screen transitions
   * - Screen rendering (splash or main UI)
   * - LED effect updates
   * - Chrome (status/button bar) visibility
   */
  void Loop();

  /** Check if still in boot/splash mode */
  bool IsBooting() const;

 protected:
  std::shared_ptr<state::IApplicationState> app_;
  hal::IHardware* hardware_ = nullptr;
  lv_obj_t* root_screen_ = nullptr;
  std::string machine_label_;

  // Screen management
  std::vector<std::shared_ptr<Screen>> screen_stack_;
  std::shared_ptr<SplashScreen> splash_screen_;  // During boot only

  // Owned UI components (chrome)
  std::unique_ptr<StatusBar> status_bar_;
  std::unique_ptr<ButtonBar> button_bar_;
  lv_obj_t* content_container_ = nullptr;  // Container for main screens

  // LED effect management
  std::shared_ptr<leds::Crossfade> crossfade_;
  std::shared_ptr<leds::Multiplexer> multiplexer_;

  // Track current effects for change detection
  std::shared_ptr<hal::ILedEffect> current_button_effect_;
  std::shared_ptr<hal::ILedEffect> current_content_effect_;

  // Internal methods
  void UpdateScreenForSystemState();
  void CreateMainUI();
  void RenderCurrentScreen();
  void UpdateLedEffects();
  void ActivateScreen(std::shared_ptr<Screen> screen);
  void DeactivateCurrentScreen();
};

}  // namespace oww::ui
