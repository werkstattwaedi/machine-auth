// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// P2 implementation of the integration test system.

#include "pb_integration_tests/firmware/test_system.h"

#include <cstddef>

// Pigweed headers first - before Particle headers that define pin macros
#include "pw_channel/stream_channel.h"
#include "pw_log/log.h"
#include "pw_multibuf/simple_allocator.h"
#include "pw_system/io.h"
#include "pw_system/system.h"
#include "pw_thread_particle/options.h"

// Particle HAL headers
#include "pb_log/log_bridge.h"
#include "delay_hal.h"
#include "system_cloud.h"
#include "usb_hal.h"

namespace pb::test {

using pw::channel::StreamChannel;

pw::rpc::Server& GetRpcServer() { return pw::System().rpc_server(); }

void TestSystemInit(pw::Function<void()> init_callback) {
  pb::log::InitLogBridge();

  // Wait up to 10s for USB serial connection (for logs/RPC)
  for (int i = 0; i < 100; i++) {
    if (HAL_USB_USART_Is_Connected(HAL_USB_USART_SERIAL)) {
      break;
    }
    HAL_Delay_Milliseconds(100);
  }

  // Flush any pending data from console that connected before we were ready
  if (HAL_USB_USART_Is_Connected(HAL_USB_USART_SERIAL)) {
    while (HAL_USB_USART_Available_Data(HAL_USB_USART_SERIAL) > 0) {
      HAL_USB_USART_Receive_Data(HAL_USB_USART_SERIAL, false);
    }
    HAL_Delay_Milliseconds(100);
  }

  // Call test-specific initialization
  init_callback();

  // Set up RPC channel over USB serial
  static std::byte channel_buffer[8192];
  static pw::multibuf::SimpleAllocator multibuf_alloc(channel_buffer,
                                                      pw::System().allocator());

  static pw::NoDestructor<StreamChannel> channel(
      pw::system::GetReader(),
      pw::thread::particle::Options()
          .set_name("rx_thread")
          .set_stack_size(8192),
      multibuf_alloc,
      pw::system::GetWriter(),
      pw::thread::particle::Options()
          .set_name("tx_thread")
          .set_stack_size(8192),
      multibuf_alloc);

  PW_LOG_INFO("=== Integration Test System Ready ===");

  pw::system::StartAndClobberTheStack(channel->channel());
  PW_UNREACHABLE;
}

bool WaitForCloudConnection(uint32_t timeout_ms) {
  PW_LOG_INFO("Waiting for cloud connection...");
  uint32_t elapsed_ms = 0;
  constexpr uint32_t kPollIntervalMs = 100;

  while (!spark_cloud_flag_connected()) {
    if (timeout_ms > 0 && elapsed_ms >= timeout_ms) {
      PW_LOG_WARN("Cloud connection timeout after %u ms",
                  static_cast<unsigned>(elapsed_ms));
      return false;
    }
    HAL_Delay_Milliseconds(kPollIntervalMs);
    elapsed_ms += kPollIntervalMs;
  }

  PW_LOG_INFO("Cloud connected after %u ms", static_cast<unsigned>(elapsed_ms));
  return true;
}

}  // namespace pb::test
