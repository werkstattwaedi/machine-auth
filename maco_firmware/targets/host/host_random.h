// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file host_random.h
/// @brief Random number generator for host simulator.
///
/// Uses std::random_device which typically provides cryptographically
/// secure random numbers on modern systems (uses /dev/urandom on Linux).

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <random>

#include "pw_random/random.h"

namespace maco {

/// Host random generator using std::random_device.
///
/// On Linux, std::random_device typically uses /dev/urandom.
class HostRandomGenerator : public pw::random::RandomGenerator {
 public:
  /// Fill destination buffer with random bytes.
  void Get(pw::ByteSpan dest) override {
    auto* ptr = dest.data();
    size_t remaining = dest.size();

    // std::random_device generates values in its result_type range
    // Typically uint32_t or unsigned int
    while (remaining >= sizeof(std::random_device::result_type)) {
      auto value = random_device_();
      std::memcpy(ptr, &value, sizeof(value));
      ptr += sizeof(value);
      remaining -= sizeof(value);
    }

    // Handle remaining bytes
    if (remaining > 0) {
      auto value = random_device_();
      std::memcpy(ptr, &value, remaining);
    }
  }

  /// Entropy injection - not needed for std::random_device.
  void InjectEntropyBits(uint32_t /* data */,
                         uint_fast8_t /* num_bits */) override {
    // std::random_device manages its own entropy source.
  }

 private:
  std::random_device random_device_;
};

}  // namespace maco
