// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file hardware_random.h
/// @brief Hardware random number generator for Particle P2.
///
/// Uses the Device OS HAL RNG which is seeded from ADC noise at boot.
/// While not a true TRNG (uses LFSR PRNG internally), it provides
/// sufficient entropy for NTAG424 mutual authentication where both
/// sides contribute randomness (RndA and RndB).

#include <cstddef>
#include <cstdint>
#include <cstring>

#include "pw_random/random.h"

extern "C" {
#include "rng_hal.h"
}

namespace maco {

/// Hardware random generator using Particle Device OS HAL.
///
/// The underlying implementation uses an LFSR PRNG seeded from ADC noise
/// at boot time. Thread-safe via peripheral mutex.
class HardwareRandomGenerator : public pw::random::RandomGenerator {
 public:
  /// Fill destination buffer with random bytes.
  void Get(pw::ByteSpan dest) override {
    auto* ptr = dest.data();
    size_t remaining = dest.size();

    // Fill 4 bytes at a time
    while (remaining >= 4) {
      uint32_t value = HAL_RNG_GetRandomNumber();
      std::memcpy(ptr, &value, 4);
      ptr += 4;
      remaining -= 4;
    }

    // Handle remaining bytes
    if (remaining > 0) {
      uint32_t value = HAL_RNG_GetRandomNumber();
      std::memcpy(ptr, &value, remaining);
    }
  }

  /// Entropy injection not supported - HAL RNG is seeded at boot.
  void InjectEntropyBits(uint32_t /* data */,
                         uint_fast8_t /* num_bits */) override {
    // The HAL RNG is seeded from ADC noise during system initialization.
    // Additional entropy injection is not supported.
  }
};

}  // namespace maco
