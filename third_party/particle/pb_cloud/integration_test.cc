// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/// @file integration_test.cc
/// @brief Manual integration test for pb_cloud on P2.
///
/// Flash this to a P2 device, then use the Particle Console to verify:
/// 1. Variables are readable
/// 2. Functions can be called
/// 3. Events are published
///
/// 4. Events can be subscribed to and received
///
/// See console output for instructions.

#include <cstring>
#include <optional>

#include "pb_cloud/cloud_backend.h"
#include "pb_cloud/particle_cloud_backend.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_string/string.h"
#include "pw_unit_test/framework.h"

// Particle system cloud header for spark_process()
#include "system_cloud.h"

// Thread yield for cooperative multitasking
#include "concurrent_hal.h"

#define PW_LOG_MODULE_NAME "pb_cloud_test"

#include "pw_log/log.h"

namespace {
using namespace std::chrono_literals;

// Test state
int g_counter = 0;
int g_last_function_result = 0;

// Cloud variables
pb::cloud::CloudVariable<int>* g_counter_var = nullptr;
pb::cloud::CloudVariable<int>* g_function_result_var = nullptr;
pb::cloud::CloudStringVariable<>* g_status_var = nullptr;

// Event subscription receiver
std::optional<pb::cloud::EventReceiver> g_event_receiver;

// Cloud function handlers
int IncrementCounter(std::string_view arg) {
  int amount = 1;
  if (!arg.empty()) {
    // Try to parse amount from arg
    amount = 0;
    for (char c : arg) {
      if (c >= '0' && c <= '9') {
        amount = amount * 10 + (c - '0');
      }
    }
    if (amount == 0) amount = 1;
  }

  g_counter += amount;
  if (g_counter_var) {
    g_counter_var->Set(g_counter);
  }

  PW_LOG_INFO("increment called with '%.*s', counter now %d",
              static_cast<int>(arg.size()), arg.data(), g_counter);
  return g_counter;
}

int ResetCounter(std::string_view) {
  g_counter = 0;
  if (g_counter_var) {
    g_counter_var->Set(g_counter);
  }
  PW_LOG_INFO("reset called, counter now 0");
  return 0;
}

int PublishTestEvent(std::string_view arg) {
  auto& cloud = pb::cloud::ParticleCloudBackend::Instance();

  pw::InlineString<128> payload;
  if (arg.empty()) {
    payload = "test_payload";
  } else {
    payload = pw::InlineString<128>(arg);
  }

  auto data = pw::as_bytes(pw::span(payload.data(), payload.size()));

  pb::cloud::PublishOptions options;
  options.scope = pb::cloud::EventScope::kPrivate;
  options.content_type = pb::cloud::ContentType::kText;

  // Publish the event
  auto future = cloud.Publish("pb_cloud_test/response", data, options);
  // Note: Future completion happens via Particle callback system
  // We don't need to poll it since this is fire-and-forget for this test

  PW_LOG_INFO("Published event: pb_cloud_test/response = %s", payload.c_str());
  g_last_function_result = static_cast<int>(payload.size());
  if (g_function_result_var) {
    g_function_result_var->Set(g_last_function_result);
  }

  return g_last_function_result;
}

void PrintInstructions() {
  PW_LOG_INFO("========================================");
  PW_LOG_INFO("pb_cloud Integration Test");
  PW_LOG_INFO("========================================");
  PW_LOG_INFO("");
  PW_LOG_INFO("Test Variables (read from Particle Console):");
  PW_LOG_INFO("  - counter: current counter value (int)");
  PW_LOG_INFO("  - funcResult: last function result (int)");
  PW_LOG_INFO("  - status: current status (string)");
  PW_LOG_INFO("");
  PW_LOG_INFO("Test Functions (call from Particle Console):");
  PW_LOG_INFO("  - increment [amount]: increment counter");
  PW_LOG_INFO("  - reset: reset counter to 0");
  PW_LOG_INFO("  - publish [payload]: publish test event");
  PW_LOG_INFO("");
  PW_LOG_INFO("Verification Steps:");
  PW_LOG_INFO("  1. Go to Particle Console > Devices > [your device]");
  PW_LOG_INFO("  2. Check Variables tab - verify counter=0, status=ready");
  PW_LOG_INFO("  3. Call function 'increment' with arg '5'");
  PW_LOG_INFO("  4. Verify counter variable is now 5");
  PW_LOG_INFO("  5. Call function 'publish' with arg 'hello'");
  PW_LOG_INFO("  6. Check Events tab for 'pb_cloud_test/response'");
  PW_LOG_INFO("");
  PW_LOG_INFO("Subscription Test:");
  PW_LOG_INFO("  7. From CLI: particle publish pb_cloud_test/cmd hello");
  PW_LOG_INFO("  8. Watch serial output for 'Received event' log");
  PW_LOG_INFO("========================================");
}

class PbCloudIntegrationTest : public ::testing::Test {
 protected:
  void SetUp() override {
    PW_LOG_INFO("=== PbCloudIntegrationTest::SetUp ===");
    auto& cloud = pb::cloud::ParticleCloudBackend::Instance();

    // Register variables
    g_counter_var = &cloud.RegisterVariable("counter", 0);
    g_function_result_var = &cloud.RegisterVariable("funcResult", 0);
    g_status_var = &cloud.RegisterStringVariable("status", "ready");

    PW_LOG_INFO("Registered variables: counter, funcResult, status");

    // Register functions
    auto status = cloud.RegisterFunction(
        "increment", [](std::string_view arg) { return IncrementCounter(arg); });
    ASSERT_TRUE(status.ok()) << "Failed to register increment function";

    status = cloud.RegisterFunction(
        "reset", [](std::string_view arg) { return ResetCounter(arg); });
    ASSERT_TRUE(status.ok()) << "Failed to register reset function";

    status = cloud.RegisterFunction(
        "publish", [](std::string_view arg) { return PublishTestEvent(arg); });
    ASSERT_TRUE(status.ok()) << "Failed to register publish function";

    PW_LOG_INFO("Registered functions: increment, reset, publish");
  }

  void TearDown() override {
    PW_LOG_INFO("=== PbCloudIntegrationTest::TearDown ===");
  }
};

// ============================================================================
// This test prints instructions and waits for manual interaction.
// The actual verification is done by the user via Particle Console.
// ============================================================================

TEST_F(PbCloudIntegrationTest, ManualVerification) {
  PrintInstructions();

  PW_LOG_INFO("");
  PW_LOG_INFO("Waiting for cloud connection...");

  // Wait for cloud connection
  while (!spark_cloud_flag_connected()) {
    spark_process();
    os_thread_yield();
  }
  PW_LOG_INFO("Cloud connected!");

  // Subscribe to events now that we're connected
  auto& cloud = pb::cloud::ParticleCloudBackend::Instance();
  g_event_receiver.emplace(cloud.Subscribe("pb_cloud_test/"));
  PW_LOG_INFO("Subscribed to pb_cloud_test/");

  PW_LOG_INFO("");
  PW_LOG_INFO("Running for 5 minutes to allow manual testing...");
  PW_LOG_INFO("Variables and functions are now available on Particle Console.");
  PW_LOG_INFO("");

  // Run spark_process() in a tight loop to handle cloud callbacks.
  // This is equivalent to Particle.process() and is REQUIRED for cloud
  // functions and variables to work with the dynalib API.
  // Use os_thread_yield() to cooperatively yield to other threads.
  constexpr int kTestDurationSeconds = 300;  // 5 minutes
  int last_printed_second = 0;
  auto start = pw::chrono::SystemClock::now();

  while (true) {
    spark_process();
    os_thread_yield();

    // Check for received events (non-blocking)
    if (g_event_receiver) {
      auto result = g_event_receiver->TryReceive();
      if (result.ok()) {
        auto& event = result.value();
        PW_LOG_INFO("Received event: name=%s, data_size=%u",
                    event.name.c_str(), static_cast<unsigned>(event.data.size()));
        // Log data as string if it's text
        if (!event.data.empty()) {
          pw::InlineString<256> data_str(
              reinterpret_cast<const char*>(event.data.data()),
              event.data.size());
          PW_LOG_INFO("  data: %s", data_str.c_str());
        }
      }
    }

    // Print status every 30 seconds
    auto elapsed = pw::chrono::SystemClock::now() - start;
    int elapsed_seconds = static_cast<int>(
        std::chrono::duration_cast<std::chrono::seconds>(elapsed).count());

    if (elapsed_seconds >= last_printed_second + 30) {
      last_printed_second = elapsed_seconds;
      PW_LOG_INFO("Test running... %d seconds elapsed", elapsed_seconds);
    }

    if (elapsed_seconds >= kTestDurationSeconds) {
      break;
    }
  }

  PW_LOG_INFO("");
  PW_LOG_INFO("Test complete.");
}

}  // namespace
