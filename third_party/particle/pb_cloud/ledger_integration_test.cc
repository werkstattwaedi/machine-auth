// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/// @file ledger_integration_test.cc
/// @brief Manual integration test for Particle Ledger backend on P2.
///
/// Flash this to a P2 device, then use the Particle Console to verify:
/// 1. Ledger data is written and synced to cloud using CBOR Property API
/// 2. Cloud-to-device ledger updates are received
///
/// Prerequisites:
/// - Configure a device-to-cloud ledger "test-ledger" in Particle Console
///
/// See console output for instructions.

#include <array>
#include <cstring>

#include "pb_cloud/ledger_backend.h"
#include "pb_cloud/particle_ledger_backend.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_string/string.h"
#include "pw_unit_test/framework.h"

// Particle system cloud header for spark_process()
#include "system_cloud.h"

// Thread yield for cooperative multitasking
#include "concurrent_hal.h"

#define PW_LOG_MODULE_NAME "ledger_test"

#include "pw_log/log.h"

namespace {
using namespace std::chrono_literals;

// Test ledger name - must be configured in Particle Console
constexpr const char* kTestLedgerName = "test-ledger";

void PrintInstructions() {
  PW_LOG_INFO("========================================");
  PW_LOG_INFO("pb_ledger Integration Test - CBOR Property API");
  PW_LOG_INFO("========================================");
  PW_LOG_INFO("");
  PW_LOG_INFO("Prerequisites:");
  PW_LOG_INFO("  Configure a device-to-cloud ledger '%s' in Particle Console",
              kTestLedgerName);
  PW_LOG_INFO("");
  PW_LOG_INFO("Verification Steps:");
  PW_LOG_INFO("  1. Watch serial output for test results");
  PW_LOG_INFO("  2. Check Particle Console > Ledger for synced data");
  PW_LOG_INFO("  3. Data should appear as named properties (not raw bytes)");
  PW_LOG_INFO("========================================");
}

class PbLedgerIntegrationTest : public ::testing::Test {
 protected:
  void SetUp() override {
    PW_LOG_INFO("=== PbLedgerIntegrationTest::SetUp ===");
  }

  void TearDown() override {
    PW_LOG_INFO("=== PbLedgerIntegrationTest::TearDown ===");
  }
};

TEST_F(PbLedgerIntegrationTest, ManualVerification) {
  PrintInstructions();

  PW_LOG_INFO("");
  PW_LOG_INFO("Waiting for cloud connection...");

  // Wait for cloud connection
  while (!spark_cloud_flag_connected()) {
    spark_process();
    os_thread_yield();
  }
  PW_LOG_INFO("Cloud connected!");

  // Wait for ledger configuration to be received from cloud
  PW_LOG_INFO("Waiting 10 seconds for ledger config from cloud...");
  auto wait_start = pw::chrono::SystemClock::now();
  while (pw::chrono::SystemClock::now() - wait_start <
         pw::chrono::SystemClock::for_at_least(std::chrono::seconds(10))) {
    spark_process();
    os_thread_yield();
  }
  PW_LOG_INFO("Done waiting.");

  auto& backend = pb::cloud::ParticleLedgerBackend::Instance();

  // Test 1: Get ledger names
  PW_LOG_INFO("");
  PW_LOG_INFO("Test 1: GetLedgerNames");
  {
    pw::Vector<pw::InlineString<pb::cloud::kMaxLedgerNameSize>,
               pb::cloud::kMaxLedgerCount>
        names;
    auto status = backend.GetLedgerNames(names);
    if (status.ok()) {
      PW_LOG_INFO("  Found %d ledgers:", static_cast<int>(names.size()));
      for (const auto& name : names) {
        PW_LOG_INFO("    - %s", name.c_str());
      }
    } else {
      PW_LOG_ERROR("  Failed: %d", static_cast<int>(status.code()));
    }
  }

  // Test 2: Get ledger handle and info
  PW_LOG_INFO("");
  PW_LOG_INFO("Test 2: GetLedger('%s')", kTestLedgerName);
  {
    auto result = backend.GetLedger(kTestLedgerName);
    if (result.ok()) {
      PW_LOG_INFO("  Got handle");

      auto info = result.value().GetInfo();
      if (info.ok()) {
        PW_LOG_INFO("  Info:");
        PW_LOG_INFO("    name: %s", info.value().name.c_str());
        PW_LOG_INFO("    data_size: %d", static_cast<int>(info.value().data_size));
        PW_LOG_INFO("    scope: %d", static_cast<int>(info.value().scope));
        PW_LOG_INFO("    sync_direction: %d",
                    static_cast<int>(info.value().sync_direction));
        PW_LOG_INFO("    sync_pending: %s",
                    info.value().sync_pending ? "true" : "false");
      } else {
        PW_LOG_ERROR("  GetInfo failed: %d",
                     static_cast<int>(info.status().code()));
      }
    } else {
      PW_LOG_WARN("  Ledger not found (configure in Console first)");
    }
  }

  // Test 3: Read existing properties
  PW_LOG_INFO("");
  PW_LOG_INFO("Test 3: Read existing properties (CBOR)");
  {
    auto result = backend.GetLedger(kTestLedgerName);
    if (result.ok()) {
      auto& handle = result.value();

      // Try to read existing properties
      bool has_test = handle.Has("test");
      bool test_val = handle.GetBool("test", false);
      int value_val = handle.GetInt("value", -1);

      PW_LOG_INFO("  has 'test': %s", has_test ? "true" : "false");
      PW_LOG_INFO("  test = %s", test_val ? "true" : "false");
      PW_LOG_INFO("  value = %d", value_val);
    } else {
      PW_LOG_WARN("  Skipping (ledger not found)");
    }
  }

  // Test 4: Write properties using LedgerEditor (CBOR)
  PW_LOG_INFO("");
  PW_LOG_INFO("Test 4: Write properties using LedgerEditor (CBOR)");
  {
    auto result = backend.GetLedger(kTestLedgerName);
    if (result.ok()) {
      auto& handle = result.value();

      // Edit ledger using property API (use smaller buffer to avoid stack overflow)
      std::array<std::byte, 512> buffer{};
      auto editor_result = handle.Edit(buffer);
      if (editor_result.ok()) {
        auto& editor = editor_result.value();
        auto s1 = editor.SetBool("test", true);
        auto s2 = editor.SetInt("value", 99);
        auto s3 = editor.SetString("message", "Hello from pb_ledger");
        auto s4 = editor.SetDouble("temperature", 23.5);

        PW_LOG_INFO("  SetBool: %s", s1.ok() ? "ok" : "failed");
        PW_LOG_INFO("  SetInt: %s", s2.ok() ? "ok" : "failed");
        PW_LOG_INFO("  SetString: %s", s3.ok() ? "ok" : "failed");
        PW_LOG_INFO("  SetDouble: %s", s4.ok() ? "ok" : "failed");

        auto commit_status = editor.Commit();
        if (commit_status.ok()) {
          PW_LOG_INFO("  Commit successful!");
        } else {
          PW_LOG_ERROR("  Commit failed: %d",
                       static_cast<int>(commit_status.code()));
        }
      } else {
        PW_LOG_ERROR("  Edit failed: %d",
                     static_cast<int>(editor_result.status().code()));
      }

      // Read back using property API
      PW_LOG_INFO("");
      PW_LOG_INFO("  Reading back via property API:");
      PW_LOG_INFO("    test = %s", handle.GetBool("test", false) ? "true" : "false");
      PW_LOG_INFO("    value = %d", handle.GetInt("value", -1));
      PW_LOG_INFO("    temperature = %.1f", handle.GetDouble("temperature", 0.0));

      std::array<char, 64> msg_buf{};
      auto msg_result = handle.GetString("message",
          pw::as_writable_bytes(pw::span(msg_buf)));
      if (msg_result.ok()) {
        PW_LOG_INFO("    message = %.*s",
                    static_cast<int>(msg_result.value()), msg_buf.data());
      }

      // Check info after write
      auto info_after = handle.GetInfo();
      if (info_after.ok()) {
        PW_LOG_INFO("  After write - sync_pending: %s",
                    info_after.value().sync_pending ? "true" : "false");
      }
    } else {
      PW_LOG_WARN("  Skipping (ledger not found)");
    }
  }

  PW_LOG_INFO("");
  PW_LOG_INFO("Running for 2 minutes to allow sync verification...");
  PW_LOG_INFO("Check Particle Console > Ledger for synced data.");
  PW_LOG_INFO("");

  // Run spark_process() in a tight loop to handle cloud callbacks.
  constexpr int kTestDurationSeconds = 120;  // 2 minutes
  int last_printed_second = 0;
  auto start = pw::chrono::SystemClock::now();

  while (true) {
    spark_process();
    os_thread_yield();

    // Print status every 30 seconds
    auto elapsed = pw::chrono::SystemClock::now() - start;
    int elapsed_seconds = static_cast<int>(
        std::chrono::duration_cast<std::chrono::seconds>(elapsed).count());

    if (elapsed_seconds >= last_printed_second + 30) {
      last_printed_second = elapsed_seconds;
      // Check sync status periodically
      auto handle = backend.GetLedger(kTestLedgerName);
      if (handle.ok()) {
        auto info = handle.value().GetInfo();
        if (info.ok()) {
          PW_LOG_INFO("Test running... %d sec, sync_pending=%s",
                      elapsed_seconds,
                      info.value().sync_pending ? "true" : "false");
        } else {
          PW_LOG_INFO("Test running... %d seconds elapsed", elapsed_seconds);
        }
      } else {
        PW_LOG_INFO("Test running... %d seconds elapsed", elapsed_seconds);
      }
    }

    if (elapsed_seconds >= kTestDurationSeconds) {
      break;
    }
  }

  PW_LOG_INFO("");
  PW_LOG_INFO("Test complete.");
}

}  // namespace
