#pragma once

#include "hardware_interface.h"
#include <SDL2/SDL.h>
#include <SDL2/SDL_ttf.h>
#include <array>
#include <vector>

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

  // Set individual LED (0-15)
  void SetLED(uint8_t index, uint8_t r, uint8_t g, uint8_t b, uint8_t w = 0) override;

  // Render LED visualization (called each frame)
  void ShowLEDs() override;

  // Button state from keyboard
  uint8_t GetButtonState() override;

  // Buzzer - just prints to console
  void Beep(uint16_t frequency_hz, uint16_t duration_ms) override;

  // Update button state from SDL keyboard events
  void UpdateButtonState(const SDL_KeyboardEvent& key);

  // Simulate NFC tag for testing
  void SimulateNFCTag(const uint8_t* uid, size_t len) override;

 private:
  SDL_Renderer* renderer_ = nullptr;
  TTF_Font* font_ = nullptr;

  // LED state (16 total LEDs)
  std::array<Color, 16> leds_;

  // Button state (keyboard mapping)
  uint8_t button_state_ = 0;

  // NFC simulation
  std::vector<uint8_t> simulated_nfc_uid_;
  bool nfc_tag_present_ = false;

  // LED physical positions (x, y, radius)
  struct LEDPosition {
    int x, y, radius;
  };
  std::array<LEDPosition, 16> led_positions_;

  // Helper to draw a filled circle
  void DrawCircle(int x, int y, int radius, const Color& color);

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
