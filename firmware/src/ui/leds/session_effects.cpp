#include "ui/leds/session_effects.h"

#include <cmath>
#include "common/time.h"

namespace oww::ui::leds {

static constexpr uint8_t kRingIndices[] = {0, 15, 14, 13, 12, 9, 8, 7, 6, 5};
static constexpr size_t kRingCount = 10;

// Animation constants
static constexpr float kRotationAcceleration = 2.0f;  // Revolutions per second²
static constexpr float kColorTransitionTime = 0.5f;   // Seconds
static constexpr float kDeniedRotationTime = 1.5f;    // Seconds before switching to blink

SessionEffect::SessionEffect()
    : current_state_(SessionState::Idle),
      rotation_position_(0.0f),
      rotation_velocity_(0.0f),
      current_color_{255, 255, 255, 0},  // White
      last_update_time_(timeSinceBoot()),
      state_change_time_(timeSinceBoot()),
      denied_blink_phase_(false) {}

void SessionEffect::SetState(SessionState new_state) {
  if (new_state == current_state_) {
    return;
  }

  current_state_ = new_state;
  state_change_time_ = timeSinceBoot();

  // Reset denied blink phase when entering denied state
  if (new_state == SessionState::Denied) {
    denied_blink_phase_ = false;
  }
}

LedColor SessionEffect::GetTargetColor(SessionState state) const {
  switch (state) {
    case SessionState::Idle:
      return LedColor{0, 0, 0, 255};  // White
    case SessionState::AuthStartSession:
      return LedColor{138, 43, 226, 0};  // Violet
    case SessionState::AuthNewSession:
      return LedColor{224, 176, 255, 0};  // Mauve
    case SessionState::AuthComplete:
      return LedColor{0, 206, 209, 0};  // Bluegreen (turquoise)
    case SessionState::Active:
      return LedColor{0, 255, 0, 0};  // Green
    case SessionState::Denied:
      return LedColor{255, 0, 0, 0};  // Red
  }
  return LedColor{255, 255, 255, 0};
}

float SessionEffect::GetTargetVelocity(SessionState state) const {
  switch (state) {
    case SessionState::Idle:
    case SessionState::Active:
      return 0.0f;  // No rotation
    case SessionState::AuthStartSession:
      return -0.5f;  // Counterclockwise
    case SessionState::AuthNewSession:
      return -0.7f;  // Counterclockwise, faster
    case SessionState::AuthComplete:
      return 0.5f;  // Clockwise
    case SessionState::Denied:
      return denied_blink_phase_ ? 0.0f : -0.8f;  // Fast counterclockwise, then stop
  }
  return 0.0f;
}

bool SessionEffect::IsRotatingState(SessionState state) const {
  return state == SessionState::AuthStartSession ||
         state == SessionState::AuthNewSession ||
         state == SessionState::AuthComplete ||
         (state == SessionState::Denied && !denied_blink_phase_);
}

bool SessionEffect::IsBreathingState(SessionState state) const {
  return state == SessionState::Idle || state == SessionState::Active;
}

std::array<LedColor, 16> SessionEffect::GetLeds(
    std::chrono::time_point<std::chrono::steady_clock> animation_time) const {

  // Calculate delta time
  auto dt = std::chrono::duration_cast<std::chrono::milliseconds>(
      animation_time - last_update_time_).count() / 1000.0f;

  // Clamp dt to prevent large jumps (e.g., after sleep or first frame)
  if (dt > 0.1f || dt < 0.0f) {
    dt = 0.016f;  // Assume 60 FPS
  }

  last_update_time_ = animation_time;

  // Check if denied should transition to blink phase
  if (current_state_ == SessionState::Denied && !denied_blink_phase_) {
    auto time_in_denied = std::chrono::duration_cast<std::chrono::milliseconds>(
        animation_time - state_change_time_).count() / 1000.0f;
    if (time_in_denied >= kDeniedRotationTime) {
      denied_blink_phase_ = true;
    }
  }

  // Update rotation velocity with acceleration/deceleration
  float target_velocity = GetTargetVelocity(current_state_);
  float velocity_diff = target_velocity - rotation_velocity_;

  if (fabsf(velocity_diff) > 0.001f) {
    float acceleration = kRotationAcceleration * dt;
    if (fabsf(velocity_diff) < acceleration) {
      rotation_velocity_ = target_velocity;
    } else {
      rotation_velocity_ += (velocity_diff > 0 ? acceleration : -acceleration);
    }
  }

  // Update rotation position
  rotation_position_ += rotation_velocity_ * dt;
  rotation_position_ = fmodf(rotation_position_, 1.0f);
  if (rotation_position_ < 0.0f) {
    rotation_position_ += 1.0f;
  }

  // Update color with smooth transition
  LedColor target_color = GetTargetColor(current_state_);
  float time_since_state_change = std::chrono::duration_cast<std::chrono::milliseconds>(
      animation_time - state_change_time_).count() / 1000.0f;

  float color_blend = fminf(time_since_state_change / kColorTransitionTime, 1.0f);
  current_color_ = LerpColor(current_color_, target_color, color_blend);

  // Render based on current state and animation mode
  if (current_state_ == SessionState::Denied && denied_blink_phase_) {
    return RenderBlink(animation_time, current_color_);
  } else if (IsRotatingState(current_state_)) {
    return RenderRotation(rotation_position_, current_color_);
  } else if (IsBreathingState(current_state_)) {
    float intensity_min = (current_state_ == SessionState::Idle) ? 0.2f : 0.7f;
    float intensity_max = 1.0f;
    return RenderBreathing(animation_time, current_color_, intensity_min, intensity_max);
  }

  // Fallback: empty
  return std::array<LedColor, 16>{};
}

float SessionEffect::GetLedPosition(size_t ring_index) const {
  if (ring_index < 5) {
    // Right side (array indices 0-4): bottom to top
    return ring_index / 4.0f;
  } else {
    // Left side (array indices 5-9): physically numbered top to bottom
    // Invert to make upward movement match right side
    return 1.0f - ((ring_index - 5) / 4.0f);
  }
}

std::array<LedColor, 16> SessionEffect::RenderRotation(float position, const LedColor& color) const {
  std::array<LedColor, 16> result;
  result.fill(LedColor::Unspecified());

  // Two spots 180 degrees apart
  float spot1_position = position;
  float spot2_position = fmodf(position + 0.5f, 1.0f);

  // Wave profile parameters (from boot_wave_effect)
  const float wave_width = 0.4f;  // Width of the trail
  constexpr float pi = 3.14159265f;

  for (size_t ring_index = 0; ring_index < kRingCount; ring_index++) {
    uint8_t led_index = kRingIndices[ring_index];
    float led_position = GetLedPosition(ring_index);

    float brightness = 0.0f;

    // Calculate brightness from spot 1
    float dist1 = led_position - spot1_position;
    // Handle wraparound
    if (dist1 > 0.5f) dist1 -= 1.0f;
    if (dist1 < -0.5f) dist1 += 1.0f;

    float normalized_dist1 = dist1 / wave_width;
    if (fabsf(normalized_dist1) < 1.0f) {
      float b1 = 0.5f * (1.0f + cosf(normalized_dist1 * pi));
      b1 = b1 * b1;  // Squared for more defined center
      brightness = fmaxf(brightness, b1);
    }

    // Calculate brightness from spot 2
    float dist2 = led_position - spot2_position;
    // Handle wraparound
    if (dist2 > 0.5f) dist2 -= 1.0f;
    if (dist2 < -0.5f) dist2 += 1.0f;

    float normalized_dist2 = dist2 / wave_width;
    if (fabsf(normalized_dist2) < 1.0f) {
      float b2 = 0.5f * (1.0f + cosf(normalized_dist2 * pi));
      b2 = b2 * b2;  // Squared for more defined center
      brightness = fmaxf(brightness, b2);
    }

    // Apply brightness to color
    result[led_index] = LedColor{
        static_cast<uint8_t>(color.r * brightness),
        static_cast<uint8_t>(color.g * brightness),
        static_cast<uint8_t>(color.b * brightness),
        static_cast<uint8_t>(color.w * brightness),
        false};
  }

  return result;
}

std::array<LedColor, 16> SessionEffect::RenderBreathing(
    std::chrono::time_point<std::chrono::steady_clock> animation_time,
    const LedColor& color, float intensity_min, float intensity_max) const {

  std::array<LedColor, 16> leds = {};

  // Breathing period
  uint16_t period_ms = 4000;  // 4 seconds for slow breathing

  // Calculate breathing intensity using sine wave
  auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(
                    animation_time.time_since_epoch()).count();
  float phase = (millis % period_ms) / static_cast<float>(period_ms);
  float intensity = (std::sin(phase * 2.0f * M_PI - M_PI / 2.0f) + 1.0f) / 2.0f;

  // Map to intensity range
  intensity = intensity_min + intensity * (intensity_max - intensity_min);

  // Apply to NFC area LEDs
  for (size_t ring_index = 0; ring_index < kRingCount; ring_index++) {
    uint8_t led_index = kRingIndices[ring_index];
    leds[led_index] = LedColor{
        static_cast<uint8_t>(color.r * intensity),
        static_cast<uint8_t>(color.g * intensity),
        static_cast<uint8_t>(color.b * intensity),
        static_cast<uint8_t>(color.w * intensity),
        false};
  }

  return leds;
}

std::array<LedColor, 16> SessionEffect::RenderBlink(
    std::chrono::time_point<std::chrono::steady_clock> animation_time,
    const LedColor& color) const {

  std::array<LedColor, 16> leds = {};

  // Fast blink
  uint16_t period_ms = 400;
  auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(
                    animation_time.time_since_epoch()).count();
  bool is_on = (millis % period_ms) < (period_ms / 2);

  LedColor led_color = is_on ? color : LedColor{0, 0, 0, 0};

  for (size_t ring_index = 0; ring_index < kRingCount; ring_index++) {
    uint8_t led_index = kRingIndices[ring_index];
    leds[led_index] = led_color;
  }

  return leds;
}

LedColor SessionEffect::LerpColor(const LedColor& a, const LedColor& b, float t) const {
  // Clamp t to [0, 1]
  t = fmaxf(0.0f, fminf(1.0f, t));

  return LedColor{
      static_cast<uint8_t>(a.r + (b.r - a.r) * t),
      static_cast<uint8_t>(a.g + (b.g - a.g) * t),
      static_cast<uint8_t>(a.b + (b.b - a.b) * t),
      static_cast<uint8_t>(a.w + (b.w - a.w) * t),
      false};
}

}  // namespace oww::ui::leds
