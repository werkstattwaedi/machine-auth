// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/system/system.h"

#include <cstddef>

#include "pb_log/log_bridge.h"
#include "pw_assert/check.h"
#include "pw_channel/stream_channel.h"
#include "pw_log/log.h"
#include "pw_multibuf/simple_allocator.h"
#include "pw_system/io.h"
#include "pw_system/system.h"
#include "pw_thread_particle/options.h"

namespace maco::system {

using pw::channel::StreamChannel;

void Init(pw::Function<void()> app_init) {
  pb::log::InitLogBridge();

  PW_LOG_INFO("=== MACO Firmware ===");

  app_init();

  PW_LOG_INFO("Initializing communication channel...");

  static std::byte channel_buffer[4096];
  static pw::multibuf::SimpleAllocator multibuf_alloc(
      channel_buffer, pw::System().allocator()
  );

  // Use pw_sys_io based I/O from particle-bazel.
  static pw::NoDestructor<StreamChannel> channel(
      pw::system::GetReader(),
      pw::thread::particle::Options()
          .set_name("rx_thread")
          .set_stack_size(4096),
      multibuf_alloc,
      pw::system::GetWriter(),
      pw::thread::particle::Options()
          .set_name("tx_thread")
          .set_stack_size(4096),
      multibuf_alloc
  );

  // On Particle, we use a custom StartSchedulerAndClobberTheStack from
  // particle-bazel that just loops forever (scheduler is already running).
  PW_LOG_INFO("Starting system...");
  pw::system::StartAndClobberTheStack(channel->channel());
  PW_UNREACHABLE;
}

}  // namespace maco::system
