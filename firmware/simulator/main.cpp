#include <SDL2/SDL.h>
#include <lvgl.h>
#include <cstdio>
#include <cstdlib>
#include <memory>

#include "hal/simulator_hardware.h"
#include "mock/mock_application.h"

// Display configuration (matching hardware)
constexpr int DISPLAY_WIDTH = 240;
constexpr int DISPLAY_HEIGHT = 320;
constexpr int WINDOW_WIDTH = 400;
constexpr int WINDOW_HEIGHT = 500;

// Global instances
static oww::hal::SimulatorHardware* g_hardware = nullptr;
static std::shared_ptr<oww::logic::MockApplication> g_app = nullptr;

// LVGL display buffer
static lv_display_t* disp = nullptr;

// SDL window and renderer
static SDL_Window* window = nullptr;
static SDL_Renderer* renderer = nullptr;
static SDL_Texture* texture = nullptr;

/**
 * @brief LVGL flush callback - copy buffer to SDL texture
 */
static void sdl_flush_cb(lv_display_t* disp, const lv_area_t* area, uint8_t* px_map) {
  if (!renderer || !texture) {
    lv_display_flush_ready(disp);
    return;
  }

  // Update texture with pixel data
  lv_coord_t w = lv_area_get_width(area);
  lv_coord_t h = lv_area_get_height(area);

  SDL_Rect rect;
  rect.x = area->x1;
  rect.y = area->y1;
  rect.w = w;
  rect.h = h;

  SDL_UpdateTexture(texture, &rect, px_map, w * sizeof(lv_color16_t));

  lv_display_flush_ready(disp);
}

/**
 * @brief Initialize SDL
 */
static bool init_sdl() {
  if (SDL_Init(SDL_INIT_VIDEO) < 0) {
    fprintf(stderr, "SDL_Init failed: %s\n", SDL_GetError());
    return false;
  }

  window = SDL_CreateWindow(
      "Machine Auth Simulator",
      SDL_WINDOWPOS_CENTERED,
      SDL_WINDOWPOS_CENTERED,
      WINDOW_WIDTH,
      WINDOW_HEIGHT,
      SDL_WINDOW_SHOWN);

  if (!window) {
    fprintf(stderr, "SDL_CreateWindow failed: %s\n", SDL_GetError());
    return false;
  }

  renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);
  if (!renderer) {
    fprintf(stderr, "SDL_CreateRenderer failed: %s\n", SDL_GetError());
    return false;
  }

  // Create texture for LVGL framebuffer
  texture = SDL_CreateTexture(
      renderer,
      SDL_PIXELFORMAT_RGB565,
      SDL_TEXTUREACCESS_STREAMING,
      DISPLAY_WIDTH,
      DISPLAY_HEIGHT);

  if (!texture) {
    fprintf(stderr, "SDL_CreateTexture failed: %s\n", SDL_GetError());
    return false;
  }

  return true;
}

/**
 * @brief Initialize LVGL
 */
static bool init_lvgl() {
  lv_init();

  // Create display
  disp = lv_display_create(DISPLAY_WIDTH, DISPLAY_HEIGHT);
  if (!disp) {
    fprintf(stderr, "lv_display_create failed\n");
    return false;
  }

  // Allocate draw buffers
  const size_t buf_size = DISPLAY_WIDTH * 40;  // 40 lines
  lv_color_t* buf1 = (lv_color_t*)malloc(buf_size * sizeof(lv_color_t));
  lv_color_t* buf2 = (lv_color_t*)malloc(buf_size * sizeof(lv_color_t));

  if (!buf1 || !buf2) {
    fprintf(stderr, "Failed to allocate LVGL buffers\n");
    return false;
  }

  lv_display_set_buffers(disp, buf1, buf2, buf_size * sizeof(lv_color_t), LV_DISPLAY_RENDER_MODE_PARTIAL);
  lv_display_set_flush_cb(disp, sdl_flush_cb);

  return true;
}

/**
 * @brief Handle SDL events
 */
static bool handle_events() {
  SDL_Event event;
  while (SDL_PollEvent(&event)) {
    switch (event.type) {
      case SDL_QUIT:
        return false;

      case SDL_KEYDOWN:
      case SDL_KEYUP:
        // Handle button inputs
        if (g_hardware) {
          g_hardware->UpdateButtonState(event.key);
        }

        // Handle special keys
        if (event.type == SDL_KEYDOWN) {
          switch (event.key.keysym.sym) {
            case SDLK_ESCAPE:
              return false;

            // NFC simulation
            case SDLK_s:
              if (g_hardware) {
                uint8_t test_uid[] = {0x04, 0xc3, 0x39, 0xaa, 0x1e, 0x18, 0x90};
                g_hardware->SimulateNFCTag(test_uid, sizeof(test_uid));
              }
              break;

            // State cycling
            case SDLK_c:
              if (g_app) {
                g_app->CycleSessionState();
              }
              break;

            case SDLK_m:
              if (g_app) {
                g_app->CycleMachineState();
              }
              break;

            // Preset states
            case SDLK_1:
              if (g_app) {
                g_app->ReturnToIdle();
              }
              break;

            case SDLK_2:
              if (g_app) {
                g_app->TriggerActiveSession();
              }
              break;

            case SDLK_3:
              if (g_app) {
                g_app->TriggerDenied();
              }
              break;

            case SDLK_b:
              if (g_app) {
                g_app->BootCompleted();
              }
              break;
          }
        }
        break;
    }
  }
  return true;
}

/**
 * @brief Main loop
 */
static void main_loop() {
  printf("\n=== Machine Auth Simulator ===\n");
  printf("Display: %dx%d portrait\n", DISPLAY_WIDTH, DISPLAY_HEIGHT);
  printf("\nKeyboard Controls:\n");
  printf("  Numpad 7 - Top-Left Button\n");
  printf("  Numpad 9 - Top-Right Button\n");
  printf("  Numpad 1 - Bottom-Left Button\n");
  printf("  Numpad 3 - Bottom-Right Button\n");
  printf("\nState Control:\n");
  printf("  1 - Return to Idle\n");
  printf("  2 - Trigger Active Session\n");
  printf("  3 - Trigger Denied\n");
  printf("  C - Cycle Session State\n");
  printf("  M - Cycle Machine State\n");
  printf("  B - Complete Boot\n");
  printf("\nOther:\n");
  printf("  S   - Simulate NFC Tag\n");
  printf("  ESC - Quit\n");
  printf("\n");

  bool running = true;
  uint32_t last_tick = SDL_GetTicks();

  while (running) {
    // Handle events
    running = handle_events();

    // Update LVGL tick
    uint32_t now = SDL_GetTicks();
    uint32_t elapsed = now - last_tick;
    lv_tick_inc(elapsed);
    last_tick = now;

    // Run LVGL tasks
    lv_timer_handler();

    // Clear screen
    SDL_SetRenderDrawColor(renderer, 0, 0, 0, 255);
    SDL_RenderClear(renderer);

    // Draw LVGL display (positioned at 50, 50)
    SDL_Rect display_rect = {50, 50, DISPLAY_WIDTH, DISPLAY_HEIGHT};
    SDL_RenderCopy(renderer, texture, NULL, &display_rect);

    // Draw LED visualizations
    if (g_hardware) {
      g_hardware->ShowLEDs();
    }

    // Present
    SDL_RenderPresent(renderer);

    // Small delay to avoid 100% CPU
    SDL_Delay(5);
  }
}

/**
 * @brief Cleanup
 */
static void cleanup() {
  g_app = nullptr;

  delete g_hardware;
  g_hardware = nullptr;

  if (texture) SDL_DestroyTexture(texture);
  if (renderer) SDL_DestroyRenderer(renderer);
  if (window) SDL_DestroyWindow(window);

  TTF_Quit();
  SDL_Quit();
}

/**
 * @brief Entry point
 */
int main(int argc, char* argv[]) {
  (void)argc;
  (void)argv;

  // Initialize SDL
  if (!init_sdl()) {
    cleanup();
    return 1;
  }

  // Initialize LVGL
  if (!init_lvgl()) {
    cleanup();
    return 1;
  }

  // Create hardware abstraction
  g_hardware = new oww::hal::SimulatorHardware();
  g_hardware->Initialize(renderer);

  // Create mock application
  g_app = std::make_shared<oww::logic::MockApplication>();
  g_app->SetBootProgress("Initializing...");
  g_app->SetBootProgress("Connecting to cloud...");
  g_app->SetBootProgress("Ready");
  // g_app->BootCompleted();  // Press 'B' to complete boot

  // TODO: Initialize UI components here
  // For now, just show a test screen
  lv_obj_t* label = lv_label_create(lv_screen_active());
  lv_label_set_text(label, "Machine Auth Simulator\n\nPress B to boot\nPress 1-3 for states\nPress C/M to cycle");
  lv_obj_center(label);

  // Test: Light up LEDs to show positions
  // Display surround (dim white)
  for (int i : {0, 5, 6, 7, 8, 9, 12, 13, 14, 15}) {
    g_hardware->SetLED(i, 0, 0, 0, 50);  // Dim white
  }

  // Buttons (different colors to identify)
  g_hardware->SetLED(1, 255, 0, 0, 0);   // Button TL - Red
  g_hardware->SetLED(4, 0, 255, 0, 0);   // Button TR - Green
  g_hardware->SetLED(10, 0, 0, 255, 0);  // Button BL - Blue
  g_hardware->SetLED(11, 255, 255, 0, 0); // Button BR - Yellow

  // NFC area (cyan)
  g_hardware->SetLED(2, 0, 255, 255, 0);  // Cyan
  g_hardware->SetLED(3, 0, 255, 255, 0);  // Cyan

  // Run main loop
  main_loop();

  // Cleanup
  cleanup();

  return 0;
}
