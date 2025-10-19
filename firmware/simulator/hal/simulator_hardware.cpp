#include "simulator_hardware.h"

#include <chrono>
#include <cmath>
#include <cstdio>

#include "hal/led_effect.h"

namespace oww::hal {

SimulatorHardware::SimulatorHardware() {
  // Initialize all LEDs to off
  for (auto& led : leds_) {
    led = {0, 0, 0, 0};
  }

  // Start LED thread
  led_thread_running_ = true;
  led_thread_ = std::thread(&SimulatorHardware::LEDThreadFunc, this);
}

SimulatorHardware::~SimulatorHardware() {
  // Signal thread to stop
  led_thread_running_ = false;

  // Wait for thread to finish
  if (led_thread_.joinable()) {
    led_thread_.join();
  }

  if (font_) {
    TTF_CloseFont(font_);
    font_ = nullptr;
  }
}

void SimulatorHardware::Initialize(SDL_Renderer* renderer) {
  renderer_ = renderer;
  InitializeLEDPositions();

  // Initialize SDL_ttf
  if (TTF_Init() < 0) {
    fprintf(stderr, "TTF_Init failed: %s\n", TTF_GetError());
    return;
  }

  // Try to load a system font
  const char* font_paths[] = {
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",  // Ubuntu/Debian
      "/usr/share/fonts/dejavu/DejaVuSans.ttf",           // Other Linux
      "/System/Library/Fonts/Helvetica.ttc",              // macOS
      "C:\\Windows\\Fonts\\arial.ttf",                    // Windows
  };

  for (const char* path : font_paths) {
    font_ = TTF_OpenFont(path, 12);
    if (font_) {
      printf("[TTF] Loaded font: %s\n", path);
      break;
    }
  }

  if (!font_) {
    fprintf(stderr, "[TTF] Warning: Could not load font: %s\n", TTF_GetError());
    fprintf(stderr, "[TTF] LED numbers will not be displayed\n");
  }
}

void SimulatorHardware::InitializeLEDPositions() {
  // Display is at (50, 50), size 240x320
  const int disp_x = 50;
  const int disp_y = 50;
  const int disp_w = 240;
  const int disp_h = 320;

  const int center_x = disp_x + disp_w / 2;  // 170
  const int bottom_y = disp_y + disp_h;      // 370

  // LED sizes
  const int ring_led_size = 10;
  const int button_led_size = 15;
  const int nfc_led_size = 8;

  // Right side: 0, 14, 15 (bottom to top)
  led_positions_[0] = {disp_x + disp_w + 20, disp_y + disp_h - 60,
                       ring_led_size};
  led_positions_[15] = {disp_x + disp_w + 20, disp_y + disp_h / 2,
                        ring_led_size};
  led_positions_[14] = {disp_x + disp_w + 20, disp_y + 60, ring_led_size};

  // Buttons: 10, 11 above display, 4, 1 below display
  const int button_top_y = disp_y - 30;
  const int button_bottom_y = bottom_y + 20;
  const int button_left_x = disp_x + 60;
  const int button_right_x = disp_x + 180;

  led_positions_[4] = {button_left_x, button_bottom_y, button_led_size};
  led_positions_[1] = {button_right_x, button_bottom_y, button_led_size};
  led_positions_[10] = {button_left_x, button_top_y, button_led_size};
  led_positions_[11] = {button_right_x, button_top_y, button_led_size};

  // NFC area: 3, 2 (left to right)
  const int nfc_y = bottom_y + 50;
  led_positions_[3] = {center_x - 25, nfc_y, nfc_led_size};
  led_positions_[2] = {center_x + 25, nfc_y, nfc_led_size};

  // Left side: 5, 6, 7 (bottom to top)
  led_positions_[5] = {disp_x - 20, disp_y + disp_h - 60, ring_led_size};
  led_positions_[6] = {disp_x - 20, disp_y + disp_h / 2, ring_led_size};
  led_positions_[7] = {disp_x - 20, disp_y + 60, ring_led_size};

  // Top corners: 8 (left), 13 (right)
  led_positions_[8] = {disp_x - 10, disp_y - 10, ring_led_size};
  led_positions_[13] = {disp_x + disp_w + 10, disp_y - 10, ring_led_size};

  // Top center: 9 (left of center), 12 (right of center)
  led_positions_[9] = {disp_x + 60, disp_y - 20, ring_led_size};
  led_positions_[12] = {disp_x + disp_w - 60, disp_y - 20, ring_led_size};
}

void SimulatorHardware::SetLED(uint8_t index, uint8_t r, uint8_t g, uint8_t b,
                               uint8_t w) {
  if (index < 16) {
    std::lock_guard<std::mutex> lock(leds_mutex_);
    leds_[index] = {r, g, b, w};
  }
}

void SimulatorHardware::ShowLEDs() {
  if (!renderer_) return;

  std::lock_guard<std::mutex> lock(leds_mutex_);
  DrawAllLEDs();
  DrawLabels();
}

void SimulatorHardware::SetLedEffect(std::shared_ptr<ILedEffect> led_effect) {
  led_effect_ = led_effect;
}

void SimulatorHardware::Beep(uint16_t frequency_hz, uint16_t duration_ms) {
  printf("[BEEP] %d Hz for %d ms\n", frequency_hz, duration_ms);
  fflush(stdout);
}

void SimulatorHardware::UpdateButtonState(const SDL_KeyboardEvent& key) {
  // Button state tracking removed - buttons now simulate touch events directly
  // This method kept for compatibility but does nothing
  (void)key;
}

void SimulatorHardware::SimulateNFCTag(const uint8_t* uid, size_t len) {
  simulated_nfc_uid_.assign(uid, uid + len);
  nfc_tag_present_ = true;
  printf("[NFC] Tag simulated: ");
  for (size_t i = 0; i < len; i++) {
    printf("%02x", uid[i]);
  }
  printf("\n");
  fflush(stdout);
}

void SimulatorHardware::DrawCircle(int x, int y, int radius, uint8_t r,
                                   uint8_t g, uint8_t b) {
  if (!renderer_) return;

  SDL_SetRenderDrawColor(renderer_, r, g, b, 255);

  // Draw filled circle using midpoint circle algorithm
  for (int w = 0; w < radius * 2; w++) {
    for (int h = 0; h < radius * 2; h++) {
      int dx = radius - w;
      int dy = radius - h;
      if ((dx * dx + dy * dy) <= (radius * radius)) {
        SDL_RenderDrawPoint(renderer_, x + dx, y + dy);
      }
    }
  }
}

void SimulatorHardware::DrawText(const char* text, int x, int y,
                                 SDL_Color color) {
  if (!font_ || !renderer_) return;

  SDL_Surface* surface = TTF_RenderText_Solid(font_, text, color);
  if (!surface) return;

  SDL_Texture* texture = SDL_CreateTextureFromSurface(renderer_, surface);
  if (!texture) {
    SDL_FreeSurface(surface);
    return;
  }

  SDL_Rect dst = {x, y, surface->w, surface->h};
  SDL_RenderCopy(renderer_, texture, NULL, &dst);

  SDL_DestroyTexture(texture);
  SDL_FreeSurface(surface);
}

void SimulatorHardware::DrawAllLEDs() {
  // Draw all 16 LEDs at their mapped positions
  for (size_t i = 0; i < leds_.size(); i++) {
    const auto& pos = led_positions_[i];
    const auto& led = leds_[i];
    // Convert RGBW to RGB (simple: add white to all channels)
    uint8_t r = std::min(255, (int)led.r + (int)led.w);
    uint8_t g = std::min(255, (int)led.g + (int)led.w);
    uint8_t b = std::min(255, (int)led.b + (int)led.w);
    DrawCircle(pos.x, pos.y, pos.radius, r, g, b);
  }

  // On first frame, print LED mapping to console
  static bool printed = false;
  if (!printed) {
    printf("\n=== LED Mapping ===\n");
    printf("Buttons: 1, 4 (below), 10, 11 (above)\n");
    printf("NFC: 2, 3\n");
    printf("Display ring: 0, 5-9, 12-15\n");
    printf("==================\n\n");
    printed = true;
  }
}

void SimulatorHardware::DrawLabels() {
  // TODO: Use SDL_ttf to draw text labels
  // For now, LED indices and button mappings are shown in console
}

void SimulatorHardware::LEDThreadFunc() {
  constexpr auto kFrameTime = std::chrono::milliseconds(16);  // ~60fps
  constexpr size_t kNumLeds = 16;

  while (led_thread_running_) {
    auto frame_start = std::chrono::steady_clock::now();

    // Render all LEDs using callback
    if (led_effect_) {
      auto colors = led_effect_->GetLeds(frame_start);
      for (uint8_t i = 0; i < kNumLeds && i < colors.size(); i++) {
        SetLED(i, colors[i].r, colors[i].g, colors[i].b, colors[i].w);
      }
      // Note: ShowLEDs() is called by the main SDL rendering loop, not here
    }

    // Maintain frame rate
    auto frame_end = std::chrono::steady_clock::now();
    auto frame_duration = std::chrono::duration_cast<std::chrono::milliseconds>(
        frame_end - frame_start);
    auto sleep_time = kFrameTime - frame_duration;

    if (sleep_time > std::chrono::milliseconds(0)) {
      std::this_thread::sleep_for(sleep_time);
    }
  }
}

}  // namespace oww::hal
