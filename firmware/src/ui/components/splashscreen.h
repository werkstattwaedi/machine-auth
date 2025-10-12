#pragma once

#include "ui/components/component.h"
#include "state/system_state.h"
#include "hal/hardware_interface.h"
#include "common/time.h"
#include <chrono>
#include <optional>

namespace oww::ui {

class SplashScreen : public Component {
 public:
  SplashScreen(std::shared_ptr<state::IApplicationState> app,
               hal::IHardware* hardware = nullptr);
  virtual ~SplashScreen();

  virtual void Render() override;

 private:
  // Hardware access
  hal::IHardware* hardware_;

  // UI elements
  lv_obj_t* image_;
  lv_obj_t* progress_label_;
  lv_obj_t* progress_bar_;

  // Animation state
  std::optional<state::system::BootPhase> current_phase_;
  std::optional<state::system::BootPhase> next_phase_;  // Queued phase for next wave
  std::chrono::time_point<std::chrono::steady_clock> animation_start_time_;

  // LED ring indices (display surround, ordered for animation)
  static constexpr uint8_t kRingIndices[] = {0, 15, 14, 13, 12, 9, 8, 7, 6, 5};
  static constexpr size_t kRingCount = 10;

  // Helper methods
  const char* GetPhaseMessage(state::system::BootPhase phase);
  void UpdateLedAnimation(state::system::BootPhase phase);
  void GetPhaseColor(state::system::BootPhase phase, uint8_t& r, uint8_t& g, uint8_t& b);
  float GetAnimationProgress();
};

}  // namespace oww::ui
