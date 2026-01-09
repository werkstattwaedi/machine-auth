// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/nfc_reader/nfc_error.h"

#include "pw_unit_test/framework.h"

namespace maco::nfc {
namespace {

TEST(IsTagGoneErrorTest, DeadlineExceeded_ReturnsTrue) {
  EXPECT_TRUE(IsTagGoneError(pw::Status::DeadlineExceeded()));
}

TEST(IsTagGoneErrorTest, DataLoss_ReturnsTrue) {
  EXPECT_TRUE(IsTagGoneError(pw::Status::DataLoss()));
}

TEST(IsTagGoneErrorTest, Unavailable_ReturnsTrue) {
  EXPECT_TRUE(IsTagGoneError(pw::Status::Unavailable()));
}

TEST(IsTagGoneErrorTest, Ok_ReturnsFalse) {
  EXPECT_FALSE(IsTagGoneError(pw::OkStatus()));
}

TEST(IsTagGoneErrorTest, InvalidArgument_ReturnsFalse) {
  EXPECT_FALSE(IsTagGoneError(pw::Status::InvalidArgument()));
}

TEST(IsTagGoneErrorTest, NotFound_ReturnsFalse) {
  EXPECT_FALSE(IsTagGoneError(pw::Status::NotFound()));
}

TEST(IsTagGoneErrorTest, PermissionDenied_ReturnsFalse) {
  EXPECT_FALSE(IsTagGoneError(pw::Status::PermissionDenied()));
}

TEST(IsTagGoneErrorTest, Internal_ReturnsFalse) {
  // Internal is a desync error, not tag-gone
  EXPECT_FALSE(IsTagGoneError(pw::Status::Internal()));
}

TEST(IsDesyncErrorTest, Internal_ReturnsTrue) {
  EXPECT_TRUE(IsDesyncError(pw::Status::Internal()));
}

TEST(IsDesyncErrorTest, Ok_ReturnsFalse) {
  EXPECT_FALSE(IsDesyncError(pw::OkStatus()));
}

TEST(IsDesyncErrorTest, DeadlineExceeded_ReturnsFalse) {
  // DeadlineExceeded is tag-gone, not desync
  EXPECT_FALSE(IsDesyncError(pw::Status::DeadlineExceeded()));
}

TEST(IsDesyncErrorTest, DataLoss_ReturnsFalse) {
  // DataLoss is tag-gone (CRC/framing), not desync
  EXPECT_FALSE(IsDesyncError(pw::Status::DataLoss()));
}

TEST(IsDesyncErrorTest, Unavailable_ReturnsFalse) {
  EXPECT_FALSE(IsDesyncError(pw::Status::Unavailable()));
}

TEST(IsDesyncErrorTest, InvalidArgument_ReturnsFalse) {
  EXPECT_FALSE(IsDesyncError(pw::Status::InvalidArgument()));
}

}  // namespace
}  // namespace maco::nfc
