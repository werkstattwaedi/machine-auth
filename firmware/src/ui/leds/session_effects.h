#pragma once

#include "ui/leds/led_effect.h"
#include <memory>

namespace oww::ui::leds {

/**
 * @brief Session state for unified LED effect
 */
enum class SessionState {
  Idle,              // White breathing
  AuthStartSession,  // Violet counterclockwise rotating
  AuthNewSession,    // Mauve counterclockwise rotation
  AuthComplete,      // Bluegreen clockwise rotation
  Active,            // Green slight breathing
  Denied             // Red counterclockwise, then blink
};

/**
 * @brief Unified LED effect for all session states with smooth transitions
 *
 * This effect handles all session visualization states with seamless transitions:
 * - Idle: White breathing
 * - Auth states: Rotating spots with long trails
 * - Active: Green breathing
 * - Denied: Red rotation followed by blinking
 *
 * Transitions between states include:
 * - Smooth color interpolation
 * - Acceleration/deceleration of rotation
 * - Seamless blending between animation modes
 */
class SessionEffect : public ILedEffect {
 public:
  SessionEffect();

  /**
   * @brief Change the session state
   * @param new_state The target state to transition to
   */
  void SetState(SessionState new_state);

  std::array<LedColor, 16> GetLeds(
      std::chrono::time_point<std::chrono::steady_clock> animation_time) const override;

 private:
  // Current state
  SessionState current_state_;

  // Animation state (mutable because GetLeds is const but updates animation)
  mutable float rotation_position_;  // 0-1, position around ring
  mutable float rotation_velocity_;  // Revolutions per second (negative = counterclockwise)
  mutable LedColor current_color_;
  mutable std::chrono::time_point<std::chrono::steady_clock> last_update_time_;
  mutable std::chrono::time_point<std::chrono::steady_clock> state_change_time_;
  mutable bool denied_blink_phase_;  // True when denied enters blink phase

  // Helper methods
  LedColor GetTargetColor(SessionState state) const;
  float GetTargetVelocity(SessionState state) const;  // Revolutions per second
  bool IsRotatingState(SessionState state) const;
  bool IsBreathingState(SessionState state) const;

  std::array<LedColor, 16> RenderRotation(float position, const LedColor& color) const;
  std::array<LedColor, 16> RenderBreathing(
      std::chrono::time_point<std::chrono::steady_clock> time,
      const LedColor& color, float intensity_min, float intensity_max) const;
  std::array<LedColor, 16> RenderBlink(
      std::chrono::time_point<std::chrono::steady_clock> time,
      const LedColor& color) const;

  float GetLedPosition(size_t ring_index) const;
  LedColor LerpColor(const LedColor& a, const LedColor& b, float t) const;
};

}  // namespace oww::ui::leds
