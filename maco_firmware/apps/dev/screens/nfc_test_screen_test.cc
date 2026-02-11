// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/apps/dev/screens/nfc_test_screen.h"

#include "gtest/gtest.h"
#include "maco_firmware/modules/display/testing/screenshot_test_harness.h"

namespace maco::dev {
namespace {

using display::testing::ScreenshotTestHarness;

class NfcTestScreenTest : public ::testing::Test {
 protected:
  void SetUp() override {
    ASSERT_EQ(harness_.Init(), pw::OkStatus());

    screen_ = std::make_unique<NfcTestScreen>();
    ASSERT_EQ(harness_.ActivateScreen(*screen_), pw::OkStatus());
  }

  void TearDown() override {
    if (screen_) {
      screen_->OnDeactivate();
    }
  }

  ScreenshotTestHarness harness_;
  std::unique_ptr<NfcTestScreen> screen_;
};

TEST_F(NfcTestScreenTest, NoCardState) {
  // Initial state is "No card"
  app_state::AppStateSnapshot snapshot;
  snapshot.state = app_state::AppStateId::kIdle;

  screen_->OnUpdate(snapshot);
  harness_.RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/apps/dev/screens/testdata/nfc_test_no_card.png",
      "/tmp/nfc_test_no_card_diff.png"));
}

TEST_F(NfcTestScreenTest, HasCardState) {
  // Simulate a detected card (RF-layer UID)
  app_state::AppStateSnapshot snapshot;
  snapshot.state = app_state::AppStateId::kTagDetected;
  snapshot.tag_uid.size = 7;
  snapshot.tag_uid.bytes[0] = std::byte{0x04};
  snapshot.tag_uid.bytes[1] = std::byte{0xAB};
  snapshot.tag_uid.bytes[2] = std::byte{0xCD};
  snapshot.tag_uid.bytes[3] = std::byte{0x12};
  snapshot.tag_uid.bytes[4] = std::byte{0x34};
  snapshot.tag_uid.bytes[5] = std::byte{0x56};
  snapshot.tag_uid.bytes[6] = std::byte{0x78};

  screen_->OnUpdate(snapshot);
  harness_.RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/apps/dev/screens/testdata/nfc_test_has_card.png",
      "/tmp/nfc_test_has_card_diff.png"));
}

}  // namespace
}  // namespace maco::dev
