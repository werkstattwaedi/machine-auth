// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/system/system.h"

#include <signal.h>
#include <stdio.h>
#include <unistd.h>

#include <chrono>
#include <functional>
#include <thread>

#include "lvgl.h"
#include "maco_firmware/targets/host/keyboard_input_driver.h"
#include "maco_firmware/targets/host/sdl_display_driver.h"
#include "pw_assert/check.h"
#include "pw_channel/stream_channel.h"
#include "pw_multibuf/simple_allocator.h"
#include "pw_system/io.h"
#include "pw_system/system.h"
#include "pw_thread_stl/options.h"


extern "C" {

void CtrlCSignalHandler(int /* ignored */) {
  printf("\nCtrl-C received; simulator exiting immediately...\n");
  // Skipping the C++ destructors since we want to exit immediately.
  _exit(0);
}

}  // extern "C"

void InstallCtrlCSignalHandler() {
  // Catch Ctrl-C to force a 0 exit code (success) to avoid signaling an error
  // for intentional exits. For example, VSCode shows an alarming dialog on
  // non-zero exit, which is confusing for users intentionally quitting.
  signal(SIGINT, CtrlCSignalHandler);
}

namespace {

// pw_system thread - runs RPC and system services in background
void PwSystemThread() {
  static std::byte channel_buffer[16384];
  static pw::multibuf::SimpleAllocator multibuf_alloc(
      channel_buffer, pw::System().allocator());
  static pw::NoDestructor<pw::channel::StreamChannel> channel(
      multibuf_alloc,
      pw::system::GetReader(),
      pw::thread::stl::Options(),
      pw::system::GetWriter(),
      pw::thread::stl::Options());

  pw::system::StartAndClobberTheStack(channel->channel());
}

// Main SDL loop - must run on main thread for SDL event handling
// Note: LVGL tick and timer handling is done by Display module's render thread
[[noreturn]] void RunSdlLoop(maco::display::SdlDisplayDriver& display) {
  using namespace std::chrono_literals;
  constexpr auto kFramePeriod = 16ms;  // ~60 FPS

  while (true) {
    // Handle SDL events (window close, etc.) - must be on main thread
    display.PumpEvents();
    if (display.quit_requested()) {
      printf("\nWindow closed, exiting...\n");
      _exit(0);
    }

    // Present frame to screen
    display.Present();

    // Frame rate limiter
    std::this_thread::sleep_for(kFramePeriod);
  }
}

}  // namespace

namespace maco::system {

void Init(pw::Function<void()> app_init) {
  app_init();

  InstallCtrlCSignalHandler();

  printf("=====================================\n");
  printf("=== MaCo: Host Simulator ===\n");
  printf("=====================================\n");
  printf("Press Ctrl-C or close window to exit\n");
  fflush(stdout);

  // Start pw_system in background thread
  static std::thread pw_system_thread(PwSystemThread);
  pw_system_thread.detach();

  // Run SDL/LVGL loop on main thread (required for SDL event handling)
  auto& display =
      static_cast<maco::display::SdlDisplayDriver&>(GetDisplayDriver());
  RunSdlLoop(display);
}

maco::display::DisplayDriver& GetDisplayDriver() {
  static maco::display::SdlDisplayDriver driver;
  return driver;
}

maco::display::TouchButtonDriver& GetTouchButtonDriver() {
  static maco::display::KeyboardInputDriver driver;
  return driver;
}

const pw::thread::Options& GetDefaultThreadOptions() {
  static const pw::thread::stl::Options options;
  return options;
}

}  // namespace maco::system
