// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

#include "maco_pb/factory_test_service.rpc.pb.h"

namespace maco::factory {

/// Function table for LED operations, populated by the caller
/// with platform-specific implementations. Avoids auto& GetLed() TU boundary.
struct LedOps {
  void (*fill)(uint8_t r, uint8_t g, uint8_t b, uint8_t w);
  void (*set_pixel)(uint16_t index, uint8_t r, uint8_t g, uint8_t b,
                    uint8_t w);
  void (*clear)();
  uint16_t led_count;
};

/// RPC service for factory hardware testing.
/// Provides direct control over LEDs and display for bring-up and QA.
class FactoryTestService final
    : public ::maco::factory::pw_rpc::nanopb::FactoryTestService::Service<
          FactoryTestService> {
 public:
  explicit FactoryTestService(const LedOps& led_ops) : led_ops_(led_ops) {}

  pw::Status LedSetAll(const ::maco_factory_LedColorRequest& request,
                       ::maco_factory_TestResponse& response);

  pw::Status LedSetPixel(const ::maco_factory_LedPixelRequest& request,
                         ::maco_factory_TestResponse& response);

  pw::Status LedClear(const ::maco_factory_Empty& request,
                      ::maco_factory_TestResponse& response);

  pw::Status DisplaySetBrightness(
      const ::maco_factory_BrightnessRequest& request,
      ::maco_factory_TestResponse& response);

  pw::Status DisplayFillColor(
      const ::maco_factory_DisplayColorRequest& request,
      ::maco_factory_TestResponse& response);

  pw::Status DisplayColorBars(const ::maco_factory_Empty& request,
                              ::maco_factory_TestResponse& response);

 private:
  LedOps led_ops_;
};

}  // namespace maco::factory
