// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_sys_io backend for Particle Device OS using USB CDC Serial.
// This enables logging via `particle serial monitor` and RPC via pw_console.
//
// Key behaviors:
// - ReadBytes: Blocks for first byte, then returns all available data.
//   This is critical for pw_system:async which expects stream-like behavior.
// - WriteLine: Protected by mutex for atomic log lines.
// - Thread yields during blocking reads to avoid starving other RTOS threads.

#include "pw_sys_io/sys_io.h"

#include "concurrent_hal.h"
#include "usb_hal.h"

namespace {

constexpr HAL_USB_USART_Serial kSerial = HAL_USB_USART_SERIAL;
constexpr uint32_t kBaudRate = 115200;

bool g_initialized = false;
os_mutex_recursive_t g_write_mutex = nullptr;

void EnsureInitialized() {
  if (!g_initialized) {
    HAL_USB_USART_Init(kSerial, nullptr);
    HAL_USB_USART_Begin(kSerial, kBaudRate, nullptr);
    os_mutex_recursive_create(&g_write_mutex);
    g_initialized = true;
  }
}

// Write a byte directly - caller must hold mutex if atomicity needed
inline void WriteByteUnsafe(uint8_t b) {
  HAL_USB_USART_Send_Data(kSerial, b);
}

}  // namespace

namespace pw::sys_io {

Status ReadByte(std::byte* dest) {
  EnsureInitialized();

  while (HAL_USB_USART_Available_Data(kSerial) <= 0) {
    // Yield to allow other threads to run while waiting for data.
    // Without this, busy-wait can starve other RTOS threads.
    os_thread_yield();
  }

  int32_t data = HAL_USB_USART_Receive_Data(kSerial, 0);
  if (data < 0) {
    return Status::ResourceExhausted();
  }

  *dest = static_cast<std::byte>(data);
  return OkStatus();
}

Status TryReadByte(std::byte* dest) {
  EnsureInitialized();

  if (HAL_USB_USART_Available_Data(kSerial) <= 0) {
    return Status::Unavailable();
  }

  int32_t data = HAL_USB_USART_Receive_Data(kSerial, 0);
  if (data < 0) {
    return Status::ResourceExhausted();
  }

  *dest = static_cast<std::byte>(data);
  return OkStatus();
}

Status WriteByte(std::byte b) {
  EnsureInitialized();

  // Single byte write - lock for safety since caller may expect atomicity
  os_mutex_recursive_lock(g_write_mutex);
  WriteByteUnsafe(static_cast<uint8_t>(b));
  os_mutex_recursive_unlock(g_write_mutex);

  return OkStatus();
}

StatusWithSize WriteLine(std::string_view s) {
  EnsureInitialized();

  // Lock for entire line - ensures atomic log output
  os_mutex_recursive_lock(g_write_mutex);

  // Write string content
  for (char c : s) {
    WriteByteUnsafe(static_cast<uint8_t>(c));
  }

  // Write CRLF
  WriteByteUnsafe('\r');
  WriteByteUnsafe('\n');

  os_mutex_recursive_unlock(g_write_mutex);

  return StatusWithSize(s.size() + 2);
}

StatusWithSize ReadBytes(ByteSpan dest) {
  if (dest.empty()) {
    return StatusWithSize(0);
  }

  // Block for at least one byte
  Status result = ReadByte(&dest[0]);
  if (!result.ok()) {
    return StatusWithSize(result, 0);
  }

  // Then read as many more bytes as available (non-blocking)
  size_t bytes_read = 1;
  while (bytes_read < dest.size_bytes()) {
    result = TryReadByte(&dest[bytes_read]);
    if (!result.ok()) {
      break;  // No more data available right now
    }
    ++bytes_read;
  }

  return StatusWithSize(bytes_read);
}

StatusWithSize WriteBytes(ConstByteSpan src) {
  EnsureInitialized();

  // Lock for entire buffer - ensures atomic output
  os_mutex_recursive_lock(g_write_mutex);

  for (size_t i = 0; i < src.size_bytes(); ++i) {
    WriteByteUnsafe(static_cast<uint8_t>(src[i]));
  }

  os_mutex_recursive_unlock(g_write_mutex);

  return StatusWithSize(src.size_bytes());
}

}  // namespace pw::sys_io
