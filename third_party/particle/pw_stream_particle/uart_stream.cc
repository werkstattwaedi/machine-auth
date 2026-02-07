// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pb_stream/uart_stream.h"

#include <algorithm>

#include "pw_log/log.h"

namespace pb {

ParticleUartStream::ParticleUartStream(hal_usart_interface_t serial)
    : serial_(serial) {
  // Initialize buffers in constructor (matching Wiring's USARTSerial constructor)
  hal_usart_buffer_config_t config = {
      .size = sizeof(hal_usart_buffer_config_t),
      .rx_buffer = rx_buffer_,
      .rx_buffer_size = kBufferSize,
      .tx_buffer = tx_buffer_,
      .tx_buffer_size = kBufferSize,
  };
  hal_usart_init_ex(serial_, &config, nullptr);
}

pw::Status ParticleUartStream::Init(uint32_t baud_rate) {
  // Configure baud rate and start (matching Wiring's begin())
  hal_usart_begin_config(serial_, baud_rate, SERIAL_8N1, nullptr);
  return pw::OkStatus();
}

void ParticleUartStream::Deinit() { hal_usart_end(serial_); }

void ParticleUartStream::Flush() { hal_usart_flush(serial_); }

pw::StatusWithSize ParticleUartStream::DoRead(pw::ByteSpan dest) {
  int32_t available = hal_usart_available(serial_);
  if (available <= 0) {
    // No data available - return immediately (non-blocking)
    return pw::StatusWithSize(0);
  }

  size_t to_read = std::min(dest.size(), static_cast<size_t>(available));
  for (size_t i = 0; i < to_read; ++i) {
    int32_t byte = hal_usart_read(serial_);
    if (byte < 0) {
      // Should not happen since we checked available(), but handle gracefully
      PW_LOG_WARN("DoRead: hal_usart_read returned %d at index %u",
                  static_cast<int>(byte), static_cast<unsigned>(i));
      return pw::StatusWithSize(i);
    }
    dest[i] = static_cast<std::byte>(byte);
  }
  return pw::StatusWithSize(to_read);
}

pw::Status ParticleUartStream::DoWrite(pw::ConstByteSpan data) {



  for (auto b : data) {
    hal_usart_write(serial_, static_cast<uint8_t>(b));
  }
  // Flush TX buffer to ensure bytes are actually transmitted
  // before returning. This is critical for request/response protocols
  // like PN532 where we need to wait for a response after sending.
  hal_usart_flush(serial_);
  return pw::OkStatus();
}

}  // namespace pb
