
#pragma once

#include "Particle.h"

// Converts a byte array to a hexadecimal and ASCII string representation.
//
// Args:
//   data: Pointer to the byte array.
//   num_bytes: Number of bytes in the array.
//
// Returns:
//   String containing the hexadecimal and ASCII representation.
// Example:
//   uint8_t data[] = {0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF};
//   String result = BytesToHexAndAsciiString(data, sizeof(data));
//   // result will be "01 23 45 67 89 AB CD EF  .#Eg...."
String BytesToHexAndAsciiString(const uint8_t *data, const size_t num_bytes);

// Converts a byte array to a hexadecimal string representation.
//
// Args:
//   data: Pointer to the byte array.
//   num_bytes: Number of bytes in the array.
//
// Returns:
//   String containing the hexadecimal representation.
// Example:
//   uint8_t data[] = {0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF};
//   String result = BytesToHexString(data, sizeof(data));
//   // result will be "01 23 45 67 89 AB CD EF"
String BytesToHexString(const uint8_t *data, const size_t num_bytes);
