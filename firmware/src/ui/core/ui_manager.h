#pragma once

#include <memory>
#include <vector>

#include "state/iapplication_state.h"
#include "ui/components/buttonbar.h"
#include "ui/components/maincontent.h"
#include "ui/leds/effect_manager.h"
#include "ui/leds/multiplexer.h"
#include "hal/hardware_interface.h"

namespace oww::ui {

/**
 * @brief Core UI manager handling content navigation and lifecycle
 *
 * Platform-independent UI logic for managing content stack, component
 * lifecycle, and button bar coordination.
 */
class UiManager {
 public:
  UiManager(std::shared_ptr<state::IApplicationState> app,
            hal::IHardware* hardware = nullptr);
  virtual ~UiManager() = default;

  /** Push a new MainContent onto the stack, making it active */
  void PushContent(std::shared_ptr<MainContent> content);

  /** Pop the current MainContent from the stack, returning to the previous one
   */
  void PopContent();

  /** Get the currently active MainContent */
  std::shared_ptr<MainContent> GetCurrentContent();

  /** Set the button bar (called by platform after creating it) */
  void SetButtonBar(ButtonBar* button_bar);

  /** Update LED effects (call from Render loop) */
  void UpdateLedEffects();

  /** Manually set an LED effect (for special cases like SplashScreen) */
  void SetLedEffect(leds::LedEffect effect);

 protected:
  std::shared_ptr<state::IApplicationState> app_;
  hal::IHardware* hardware_ = nullptr;
  ButtonBar* button_bar_ = nullptr;
  std::vector<std::shared_ptr<MainContent>> content_stack_;

  // LED effect management
  std::unique_ptr<leds::EffectManager> effect_manager_;
  std::unique_ptr<leds::Multiplexer> multiplexer_;

  void ActivateContent(std::shared_ptr<MainContent> content);
  void DeactivateCurrentContent();
};

}  // namespace oww::ui
