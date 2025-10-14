#pragma once

#include "../../src/hal/hardware_interface.h"

#include <SDL2/SDL.h>
#include <SDL2/SDL_ttf.h>

#include <array>
#include <vector>
#include <thread>
#include <atomic>
#include <mutex>

namespace oww::hal {

/**
 * @brief Simulator implementation of hardware interface
 *
 * Visualizes LEDs as colored circles around the LVGL display window.
 * Maps keyboard keys to physical buttons.
 * Prints buzzer commands to console.
 */
class SimulatorHardware : public IHardware {
 public:
  SimulatorHardware();
  ~SimulatorHardware() override;

  // Initialize SDL renderer (called after SDL_CreateRenderer)
  void Initialize(SDL_Renderer* renderer);

  // Set LED callback (runs on dedicated thread)
  void SetLedCallback(LedCallback callback) override;

  // Render LEDs visually (called by main loop for SDL rendering)
  void ShowLEDs();

  // Buzzer - just prints to console
  void Beep(uint16_t frequency_hz, uint16_t duration_ms) override;

  // Update button state from SDL keyboard events (for internal tracking)
  void UpdateButtonState(const SDL_KeyboardEvent& key);

  // Simulate NFC tag for testing (simulator-specific, not part of IHardware)
  void SimulateNFCTag(const uint8_t* uid, size_t len);

 private:
  SDL_Renderer* renderer_ = nullptr;
  TTF_Font* font_ = nullptr;

  // Button state (keyboard mapping)
  uint8_t button_state_ = 0;

  // NFC simulation
  std::vector<uint8_t> simulated_nfc_uid_;
  bool nfc_tag_present_ = false;

  // LED state (16 total LEDs)
  struct LedState {
    uint8_t r{0}, g{0}, b{0}, w{0};
  };
  std::array<LedState, 16> leds_;
  std::mutex leds_mutex_;  // Protect LED state from concurrent access

  // LED callback system
  LedCallback led_callback_;
  std::thread led_thread_;
  std::atomic<bool> led_thread_running_{false};

  // Internal LED control (called by LED thread)
  void SetLED(uint8_t index, uint8_t r, uint8_t g, uint8_t b, uint8_t w = 0);

  // LED thread function
  void LEDThreadFunc();

  // LED physical positions (x, y, radius)
  struct LEDPosition {
    int x, y, radius;
  };
  std::array<LEDPosition, 16> led_positions_;

  // Helper to draw a filled circle
  void DrawCircle(int x, int y, int radius, uint8_t r, uint8_t g, uint8_t b);

  // Helper to draw text
  void DrawText(const char* text, int x, int y, SDL_Color color);

  // Initialize LED positions based on hardware layout
  void InitializeLEDPositions();

  // Draw all LEDs
  void DrawAllLEDs();

  // Draw labels for button mappings
  void DrawLabels();
};

}  // namespace oww::hal
