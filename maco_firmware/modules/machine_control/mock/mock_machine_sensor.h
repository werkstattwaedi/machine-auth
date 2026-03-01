// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/machine_control/machine_sensor.h"

namespace maco::machine_control {

/// Mock sensor for host simulator and unit tests.
///
/// Start() fires initial callback. SetRunning() fires callback on change.
class MockMachineSensor : public MachineSensor {
 public:
  void Start(pw::async2::Dispatcher&) override {
    NotifyRunning(running_);
  }

  void SetRunning(bool running) {
    running_ = running;
    NotifyRunning(running);
  }

 private:
  bool running_ = false;
};

}  // namespace maco::machine_control
