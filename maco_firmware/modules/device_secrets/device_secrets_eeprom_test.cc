// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Hardware test for DeviceSecretsEeprom - runs on P2 device with real EEPROM.
//
// This test uses a dedicated EEPROM offset (0x100) to avoid interfering with
// actual device secrets stored at offset 0.

#include "maco_firmware/modules/device_secrets/device_secrets_eeprom.h"

#include <array>

#include "pw_bytes/array.h"
#include "pw_unit_test/framework.h"

namespace maco::secrets {
namespace {

// Test constants
constexpr auto kTestGatewaySecret = pw::bytes::Array<
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F>();

constexpr auto kTestNtagKey = pw::bytes::Array<
    0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
    0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F>();

// Use offset 0x100 for testing to avoid overwriting real secrets at offset 0
constexpr size_t kTestEepromOffset = 0x100;

class DeviceSecretsEepromHardwareTest : public ::testing::Test {
 protected:
  void SetUp() override {
    // Create storage at test offset using real EEPROM HAL
    storage_ = std::make_unique<DeviceSecretsEeprom>(
        DeviceSecretsEeprom::DefaultEepromGet(),
        DeviceSecretsEeprom::DefaultEepromPut(),
        kTestEepromOffset);

    // Clear any existing data at test offset
    storage_->Clear();
  }

  void TearDown() override {
    // Clear test data after each test
    if (storage_) {
      storage_->Clear();
    }
  }

  std::unique_ptr<DeviceSecretsEeprom> storage_;
};

TEST_F(DeviceSecretsEepromHardwareTest, InitialStateNotProvisioned) {
  EXPECT_FALSE(storage_->IsProvisioned());
}

TEST_F(DeviceSecretsEepromHardwareTest, GetSecretsWhenNotProvisionedReturnsNotFound) {
  auto gateway_result = storage_->GetGatewayMasterSecret();
  EXPECT_FALSE(gateway_result.ok());
  EXPECT_EQ(gateway_result.status(), pw::Status::NotFound());

  auto ntag_result = storage_->GetNtagTerminalKey();
  EXPECT_FALSE(ntag_result.ok());
  EXPECT_EQ(ntag_result.status(), pw::Status::NotFound());
}

TEST_F(DeviceSecretsEepromHardwareTest, ProvisionAndReadBack) {
  // Create KeyBytes from test constants
  auto gateway_secret = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestGatewaySecret)));
  auto ntag_key = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestNtagKey)));
  ASSERT_TRUE(gateway_secret.ok());
  ASSERT_TRUE(ntag_key.ok());

  // Provision
  auto status = storage_->Provision(*gateway_secret, *ntag_key);
  EXPECT_TRUE(status.ok());

  // Verify provisioned
  EXPECT_TRUE(storage_->IsProvisioned());

  // Read back and verify
  auto read_gateway = storage_->GetGatewayMasterSecret();
  ASSERT_TRUE(read_gateway.ok());
  EXPECT_EQ(read_gateway->array(), gateway_secret->array());

  auto read_ntag = storage_->GetNtagTerminalKey();
  ASSERT_TRUE(read_ntag.ok());
  EXPECT_EQ(read_ntag->array(), ntag_key->array());
}

TEST_F(DeviceSecretsEepromHardwareTest, ProvisionPersistsAcrossInstances) {
  // Create KeyBytes from test constants
  auto gateway_secret = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestGatewaySecret)));
  auto ntag_key = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestNtagKey)));
  ASSERT_TRUE(gateway_secret.ok());
  ASSERT_TRUE(ntag_key.ok());

  // Provision with first instance
  {
    auto status = storage_->Provision(*gateway_secret, *ntag_key);
    EXPECT_TRUE(status.ok());
  }

  // Create new instance at same offset and verify data persisted
  {
    DeviceSecretsEeprom new_storage(
        DeviceSecretsEeprom::DefaultEepromGet(),
        DeviceSecretsEeprom::DefaultEepromPut(),
        kTestEepromOffset);

    EXPECT_TRUE(new_storage.IsProvisioned());

    auto read_gateway = new_storage.GetGatewayMasterSecret();
    ASSERT_TRUE(read_gateway.ok());
    EXPECT_EQ(read_gateway->array(), gateway_secret->array());

    auto read_ntag = new_storage.GetNtagTerminalKey();
    ASSERT_TRUE(read_ntag.ok());
    EXPECT_EQ(read_ntag->array(), ntag_key->array());
  }
}

TEST_F(DeviceSecretsEepromHardwareTest, ClearRemovesSecrets) {
  // Create KeyBytes from test constants
  auto gateway_secret = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestGatewaySecret)));
  auto ntag_key = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestNtagKey)));
  ASSERT_TRUE(gateway_secret.ok());
  ASSERT_TRUE(ntag_key.ok());

  // Provision first
  auto status = storage_->Provision(*gateway_secret, *ntag_key);
  EXPECT_TRUE(status.ok());
  EXPECT_TRUE(storage_->IsProvisioned());

  // Clear
  storage_->Clear();

  // Verify cleared
  EXPECT_FALSE(storage_->IsProvisioned());

  auto gateway_result = storage_->GetGatewayMasterSecret();
  EXPECT_FALSE(gateway_result.ok());
  EXPECT_EQ(gateway_result.status(), pw::Status::NotFound());
}

TEST_F(DeviceSecretsEepromHardwareTest, ClearPersistsAcrossInstances) {
  // Create KeyBytes from test constants
  auto gateway_secret = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestGatewaySecret)));
  auto ntag_key = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestNtagKey)));
  ASSERT_TRUE(gateway_secret.ok());
  ASSERT_TRUE(ntag_key.ok());

  // Provision
  auto status = storage_->Provision(*gateway_secret, *ntag_key);
  EXPECT_TRUE(status.ok());

  // Clear
  storage_->Clear();

  // Create new instance and verify cleared state persisted
  DeviceSecretsEeprom new_storage(
      DeviceSecretsEeprom::DefaultEepromGet(),
      DeviceSecretsEeprom::DefaultEepromPut(),
      kTestEepromOffset);

  EXPECT_FALSE(new_storage.IsProvisioned());
}

}  // namespace
}  // namespace maco::secrets
