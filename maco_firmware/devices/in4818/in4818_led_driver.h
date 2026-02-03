// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstdint>

#include "maco_firmware/modules/led/led_driver.h"
#include "pw_span/span.h"
#include "pw_spi/initiator.h"
#include "pw_status/status.h"
#include "pw_status/try.h"

namespace maco::led {

/// Driver for IN4818 RGBW individually-addressable LEDs.
///
/// Uses SPI-based signal generation with DMA for non-blocking updates.
/// Color order: GRBW (Green-Red-Blue-White).
///
/// Signal timing at 3.125 MHz SPI clock:
/// - 3 SPI bits encode 1 data bit (~0.96µs per data bit)
/// - Logic 1: 0b110 (high-high-low)
/// - Logic 0: 0b100 (high-low-low)
/// - Reset: 300µs of low (120 zero bytes)
///
/// @tparam kNumLeds Number of LEDs in the strip (default 16).
template <uint16_t kNumLeds = 16>
class In4818LedDriver
    : public LedDriver<In4818LedDriver<kNumLeds>, kNumLeds> {
 public:
  using Base = LedDriver<In4818LedDriver<kNumLeds>, kNumLeds>;
  friend Base;

  /// SPI clock frequency for WS2812-style timing.
  /// 3.125 MHz = 0.32µs per bit, 3 bits = 0.96µs per data bit.
  static constexpr uint32_t kSpiClockHz = 3'125'000;

  /// Bytes per LED: 4 colors × 8 bits × 3 SPI bits / 8 = 12 bytes.
  static constexpr size_t kBytesPerLed = 12;

  /// Reset time: 300µs at 3.125 MHz = 937.5 bits ≈ 120 bytes.
  static constexpr size_t kResetBytes = 120;

  /// Total SPI buffer size (reset at start + pixel data + reset at end).
  static constexpr size_t kBufferSize =
      kResetBytes + kNumLeds * kBytesPerLed + kResetBytes;

  /// SPI configuration for WS2812-style timing.
  static constexpr pw::spi::Config kSpiConfig = {
      .polarity = pw::spi::ClockPolarity::kActiveHigh,
      .phase = pw::spi::ClockPhase::kFallingEdge,
      .bits_per_word = pw::spi::BitsPerWord(8),
      .bit_order = pw::spi::BitOrder::kMsbFirst,
  };

  /// Construct with SPI initiator.
  /// @param spi SPI initiator (should be configured for kSpiClockHz).
  explicit In4818LedDriver(pw::spi::Initiator& spi) : spi_(spi) {}

 private:
  // CRTP implementation methods
  pw::Status DoInit();
  void DoSetPixel(uint16_t index, RgbwColor color) { pixels_[index] = color; }
  RgbwColor DoGetPixel(uint16_t index) const { return pixels_[index]; }
  void DoSetBrightness(uint8_t b) { brightness_ = b; }
  uint8_t DoBrightness() const { return brightness_; }
  pw::Status DoShow();

  /// Encode a single byte into 3 SPI bytes using WS2812 encoding.
  /// @param value The byte to encode.
  /// @param dest Pointer to 3-byte destination buffer.
  static void EncodeByte(uint8_t value, uint8_t* dest);

  /// Encode a single pixel (GRBW order) into the SPI buffer.
  void EncodePixel(uint16_t index);

  pw::spi::Initiator& spi_;
  std::array<RgbwColor, kNumLeds> pixels_{};
  alignas(4) std::array<uint8_t, kBufferSize> spi_buffer_{};
  uint8_t brightness_ = 255;
};

// Template implementation in header for now (could be moved to .cc with
// explicit instantiation if needed)

template <uint16_t kNumLeds>
pw::Status In4818LedDriver<kNumLeds>::DoInit() {
  // Configure SPI
  PW_TRY(spi_.Configure(kSpiConfig));

  // Initialize buffer with reset pattern (all zeros)
  spi_buffer_.fill(0);

  // Clear all pixels
  pixels_.fill(RgbwColor::Black());

  return pw::OkStatus();
}

template <uint16_t kNumLeds>
void In4818LedDriver<kNumLeds>::EncodeByte(uint8_t value, uint8_t* dest) {
  // WS2812 encoding: each data bit becomes 3 SPI bits
  // Logic 1: 110 (high-high-low)
  // Logic 0: 100 (high-low-low)
  //
  // 8 data bits → 24 SPI bits → 3 bytes
  // We process 8 bits MSB first, outputting 3 bytes total.

  uint32_t encoded = 0;
  for (int i = 7; i >= 0; --i) {
    encoded <<= 3;
    if (value & (1 << i)) {
      encoded |= 0b110;  // Logic 1
    } else {
      encoded |= 0b100;  // Logic 0
    }
  }

  // Extract 3 bytes from 24-bit result (MSB first)
  dest[0] = static_cast<uint8_t>((encoded >> 16) & 0xFF);
  dest[1] = static_cast<uint8_t>((encoded >> 8) & 0xFF);
  dest[2] = static_cast<uint8_t>(encoded & 0xFF);
}

template <uint16_t kNumLeds>
void In4818LedDriver<kNumLeds>::EncodePixel(uint16_t index) {
  const RgbwColor& pixel = pixels_[index];
  // Offset by kResetBytes to skip the initial reset/latch period
  uint8_t* dest = &spi_buffer_[kResetBytes + index * kBytesPerLed];

  // Apply brightness scaling
  uint8_t g = (pixel.g * brightness_) / 255;
  uint8_t r = (pixel.r * brightness_) / 255;
  uint8_t b = (pixel.b * brightness_) / 255;
  uint8_t w = (pixel.w * brightness_) / 255;

  // GRBW order
  EncodeByte(g, dest + 0);
  EncodeByte(r, dest + 3);
  EncodeByte(b, dest + 6);
  EncodeByte(w, dest + 9);
}

template <uint16_t kNumLeds>
pw::Status In4818LedDriver<kNumLeds>::DoShow() {
  // Encode all pixels into SPI buffer
  for (uint16_t i = 0; i < kNumLeds; ++i) {
    EncodePixel(i);
  }

  // Reset bytes are already zero from init/previous clear

  // Send the buffer via SPI (blocking for now, DMA would be non-blocking)
  PW_TRY(spi_.WriteRead(pw::as_bytes(pw::span(spi_buffer_)), {}));

  return pw::OkStatus();
}

}  // namespace maco::led
