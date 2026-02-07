// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_stream/stream.h"
#include "usart_hal.h"

namespace pb {

/// Non-blocking UART stream wrapper using Particle HAL.
///
/// This class wraps the Particle HAL UART as a pw::stream::NonSeekableReaderWriter.
/// The key semantic is **non-blocking reads**: Read() returns immediately with
/// available bytes (0 if none), which enables polling-based async I/O patterns.
///
/// Usage:
/// @code
///   pb::ParticleUartStream uart(HAL_USART_SERIAL1);
///   uart.Init(115200);
///
///   // Use with PN532 driver
///   Pn532Driver driver(uart, reset_pin);
/// @endcode
///
/// @note Must call Init() before use.
class ParticleUartStream : public pw::stream::NonSeekableReaderWriter {
 public:
  /// Construct a UART stream wrapper.
  /// @param serial HAL UART interface (e.g., HAL_USART_SERIAL1)
  /// Note: Constructor initializes buffers (like Wiring's USARTSerial constructor).
  /// Call Init() to configure baud rate and start communication.
  explicit ParticleUartStream(hal_usart_interface_t serial);

  /// Initialize the UART with specified baud rate.
  /// @param baud_rate Baud rate (default 115200 for PN532)
  /// @return OkStatus on success
  pw::Status Init(uint32_t baud_rate = 115200);

  /// Shutdown the UART.
  void Deinit();

  /// Flush TX buffer - wait for all bytes to be transmitted.
  void Flush();

 private:
  /// Non-blocking read. Returns immediately with available bytes.
  /// @param dest Buffer to read into
  /// @return Number of bytes read (0 if nothing available)
  pw::StatusWithSize DoRead(pw::ByteSpan dest) override;

  /// Write data to UART. Writes all bytes.
  /// @param data Data to write
  /// @return OkStatus on success
  pw::Status DoWrite(pw::ConstByteSpan data) override;

  hal_usart_interface_t serial_;

  // Buffer storage - sized to match SERIAL_BUFFER_SIZE (64 on P2)
  static constexpr size_t kBufferSize = 64;
  uint8_t rx_buffer_[kBufferSize]{};
  uint8_t tx_buffer_[kBufferSize]{};
};

}  // namespace pb
