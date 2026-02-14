// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Hardware test for DeviceSecretsEeprom - runs on P2 device with real flash.
//
// Uses a separate flash sector (one after the default) to avoid interfering
// with actual device secrets.

#include "maco_firmware/modules/device_secrets/device_secrets_eeprom.h"

#include <array>

#define PARTICLE_USE_UNSTABLE_API
#include "pw_bytes/array.h"
#include "pw_unit_test/framework.h"
#include "storage_hal.h"

namespace maco::secrets {
namespace {

constexpr auto kTestGatewaySecret = pw::bytes::Array<
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F>();

constexpr auto kTestNtagKey = pw::bytes::Array<
    0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
    0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F>();

// One sector after the default to avoid overwriting real secrets
constexpr uintptr_t kTestFlashAddress =
    DeviceSecretsEeprom::kDefaultFlashAddress + DeviceSecretsEeprom::kSectorSize;

DeviceSecretsEeprom MakeTestStorage() {
  return DeviceSecretsEeprom(
      [](uintptr_t addr, uint8_t* data, size_t len) {
        return hal_storage_read(HAL_STORAGE_ID_EXTERNAL_FLASH, addr, data, len);
      },
      [](uintptr_t addr, const uint8_t* data, size_t len) {
        return hal_storage_write(HAL_STORAGE_ID_EXTERNAL_FLASH, addr, data, len);
      },
      [](uintptr_t addr, size_t len) {
        return hal_storage_erase(HAL_STORAGE_ID_EXTERNAL_FLASH, addr, len);
      },
      kTestFlashAddress);
}

class DeviceSecretsEepromHardwareTest : public ::testing::Test {
 protected:
  void SetUp() override {
    storage_ = MakeTestStorage();
    storage_.Clear();
  }

  void TearDown() override { storage_.Clear(); }

  DeviceSecretsEeprom storage_{MakeTestStorage()};
};

TEST_F(DeviceSecretsEepromHardwareTest, InitialStateNotProvisioned) {
  EXPECT_FALSE(storage_.IsProvisioned());
}

TEST_F(DeviceSecretsEepromHardwareTest, GetSecretsWhenNotProvisionedReturnsNotFound) {
  EXPECT_EQ(storage_.GetGatewayMasterSecret().status(), pw::Status::NotFound());
  EXPECT_EQ(storage_.GetNtagTerminalKey().status(), pw::Status::NotFound());
}

TEST_F(DeviceSecretsEepromHardwareTest, ProvisionAndReadBack) {
  auto gateway_secret = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestGatewaySecret)));
  auto ntag_key = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestNtagKey)));
  ASSERT_TRUE(gateway_secret.ok());
  ASSERT_TRUE(ntag_key.ok());

  EXPECT_TRUE(storage_.Provision(*gateway_secret, *ntag_key).ok());
  EXPECT_TRUE(storage_.IsProvisioned());

  auto read_gateway = storage_.GetGatewayMasterSecret();
  ASSERT_TRUE(read_gateway.ok());
  EXPECT_EQ(read_gateway->array(), gateway_secret->array());

  auto read_ntag = storage_.GetNtagTerminalKey();
  ASSERT_TRUE(read_ntag.ok());
  EXPECT_EQ(read_ntag->array(), ntag_key->array());
}

TEST_F(DeviceSecretsEepromHardwareTest, ClearRemovesSecrets) {
  auto gateway_secret = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestGatewaySecret)));
  auto ntag_key = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestNtagKey)));
  ASSERT_TRUE(gateway_secret.ok());
  ASSERT_TRUE(ntag_key.ok());

  EXPECT_TRUE(storage_.Provision(*gateway_secret, *ntag_key).ok());
  EXPECT_TRUE(storage_.IsProvisioned());

  storage_.Clear();

  EXPECT_FALSE(storage_.IsProvisioned());
  EXPECT_EQ(storage_.GetGatewayMasterSecret().status(), pw::Status::NotFound());
}

TEST_F(DeviceSecretsEepromHardwareTest, ProvisionPersistsAcrossInstances) {
  auto gateway_secret = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestGatewaySecret)));
  auto ntag_key = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestNtagKey)));
  ASSERT_TRUE(gateway_secret.ok());
  ASSERT_TRUE(ntag_key.ok());

  EXPECT_TRUE(storage_.Provision(*gateway_secret, *ntag_key).ok());

  // Create a fresh instance pointing at the same flash sector
  auto storage2 = MakeTestStorage();

  EXPECT_TRUE(storage2.IsProvisioned());

  auto read_gateway = storage2.GetGatewayMasterSecret();
  ASSERT_TRUE(read_gateway.ok());
  EXPECT_EQ(read_gateway->array(), gateway_secret->array());

  auto read_ntag = storage2.GetNtagTerminalKey();
  ASSERT_TRUE(read_ntag.ok());
  EXPECT_EQ(read_ntag->array(), ntag_key->array());
}

TEST_F(DeviceSecretsEepromHardwareTest, ClearPersistsAcrossInstances) {
  auto gateway_secret = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestGatewaySecret)));
  auto ntag_key = KeyBytes::FromBytes(pw::as_bytes(pw::span(kTestNtagKey)));
  ASSERT_TRUE(gateway_secret.ok());
  ASSERT_TRUE(ntag_key.ok());

  EXPECT_TRUE(storage_.Provision(*gateway_secret, *ntag_key).ok());
  storage_.Clear();

  // Create a fresh instance - should see cleared state from flash
  auto storage2 = MakeTestStorage();

  EXPECT_FALSE(storage2.IsProvisioned());
  EXPECT_EQ(storage2.GetGatewayMasterSecret().status(), pw::Status::NotFound());
}

}  // namespace
}  // namespace maco::secrets
