// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstdint>

#include "pw_spi/initiator.h"
#include "pw_status/status.h"
#include "pw_sync/binary_semaphore.h"

namespace pb {

/// Configuration flags for SPI initiator (abstraction over HAL flags).
enum class SpiFlags : uint32_t {
  kNone = 0,
  /// Use only MOSI pin, leaving MISO and SCK available for other uses.
  /// Required when sharing SPI bus pins with GPIO functions.
  kMosiOnly = 1 << 0,
};

/// Enable bitwise OR for SpiFlags.
constexpr SpiFlags operator|(SpiFlags a, SpiFlags b) {
  return static_cast<SpiFlags>(static_cast<uint32_t>(a) |
                               static_cast<uint32_t>(b));
}

/// Enable bitwise AND check for SpiFlags.
constexpr bool operator&(SpiFlags a, SpiFlags b) {
  return (static_cast<uint32_t>(a) & static_cast<uint32_t>(b)) != 0;
}

/// Pigweed SPI Initiator backend for Particle using HAL SPI API.
/// Wraps hal_spi_* functions from spi_hal.h.
///
/// Note: This initiator does NOT manage chip select (CS). Use
/// pw::spi::DigitalOutChipSelector or manual GPIO control for CS.
class ParticleSpiInitiator : public pw::spi::Initiator {
 public:
  /// SPI interface selection (maps to HAL_SPI_INTERFACE1/2/3)
  enum class Interface : uint8_t {
    kSpi = 0,   // HAL_SPI_INTERFACE1 (pins A3, A4, A5)
    kSpi1 = 1,  // HAL_SPI_INTERFACE2 (pins D4, D3, D2)
    kSpi2 = 2,  // HAL_SPI_INTERFACE3
  };

  /// Constructor.
  /// @param interface The SPI interface to use (SPI, SPI1, or SPI2)
  /// @param clock_hz Target clock frequency in Hz (will be rounded down to
  ///                 nearest available divider)
  /// @param flags Optional configuration flags (e.g., SpiFlags::kMosiOnly)
  explicit ParticleSpiInitiator(Interface interface, uint32_t clock_hz,
                                SpiFlags flags = SpiFlags::kNone);

  ~ParticleSpiInitiator() override;

  // Non-copyable, non-movable (due to static registration)
  ParticleSpiInitiator(const ParticleSpiInitiator&) = delete;
  ParticleSpiInitiator& operator=(const ParticleSpiInitiator&) = delete;
  ParticleSpiInitiator(ParticleSpiInitiator&&) = delete;
  ParticleSpiInitiator& operator=(ParticleSpiInitiator&&) = delete;

 private:
  pw::Status DoConfigure(const pw::spi::Config& config) override;
  pw::Status DoWriteRead(pw::ConstByteSpan write_buffer,
                         pw::ByteSpan read_buffer) override;

  // DMA completion callbacks per interface (needed because HAL callback has no
  // user data). These are static member functions that look up the active
  // instance by interface index.
  static void DmaCallback0();
  static void DmaCallback1();
  static void DmaCallback2();
  static void (*GetDmaCallback(Interface interface))();

  // Registry of active instances per interface. Only one initiator can use
  // each SPI interface at a time. This is a class-scoped static, not a global.
  static constexpr size_t kMaxInterfaces = 3;
  static std::array<ParticleSpiInitiator*, kMaxInterfaces> active_instances_;

  Interface interface_;
  uint32_t clock_hz_;
  SpiFlags flags_;
  pw::sync::BinarySemaphore dma_complete_;
  bool initialized_ = false;
};

}  // namespace pb
