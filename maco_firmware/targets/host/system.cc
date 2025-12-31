// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/system/system.h"

#include <signal.h>
#include <stdio.h>
#include <unistd.h>

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

namespace maco::system {

void Init(pw::Function<void()> app_init) {
  app_init();

  InstallCtrlCSignalHandler();
  printf("=====================================\n");
  printf("=== MaCo: Host Simulator ===\n");
  printf("=====================================\n");
  printf("Simulator is now running. To connect with a console,\n");
  printf("either run one in a new terminal:\n");
  printf("\n");
  printf("   $ bazelisk run //<app>:simulator_console\n");
  printf("\n");
  printf("where <app> is e.g. blinky, factory, or production, or launch\n");
  printf("one from VSCode under the 'Bazel Build Targets' explorer tab.\n");
  printf("\n");
  printf("Press Ctrl-C to exit\n");

  static std::byte channel_buffer[16384];
  static pw::multibuf::SimpleAllocator multibuf_alloc(
      channel_buffer, pw::System().allocator()
  );
  static pw::NoDestructor<pw::channel::StreamChannel> channel(
      multibuf_alloc,
      pw::system::GetReader(),
      pw::thread::stl::Options(),
      pw::system::GetWriter(),
      pw::thread::stl::Options()
  );

  pw::system::StartAndClobberTheStack(channel->channel());
  PW_UNREACHABLE;
}

maco::display::DisplayDriver& GetDisplayDriver() {
  static maco::display::SdlDisplayDriver driver;
  return driver;
}

maco::display::TouchButtonDriver& GetTouchButtonDriver() {
  static maco::display::KeyboardInputDriver driver;
  return driver;
}

}  // namespace maco::system
