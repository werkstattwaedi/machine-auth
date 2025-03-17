#pragma once

#include <iomanip>
#include <sstream>

#include "Particle.h"

template <size_t length>
tl::expected<std::array<std::byte, length>, void> HexStringToBytes(
    const std::string& hex_string) {
  static_assert(length > 0, "Array must not be empty");

  if (hex_string.length() != 2 * length) {
    return tl::unexpected<void>();
  }

  std::array<std::byte, length> result;
  std::istringstream iss(hex_string);
  iss >> std::hex;  // Set the stream to interpret input as hexadecimal

  for (size_t i = 0; i < length; ++i) {
    int byte_value;
    iss >> std::setw(2) >> byte_value;
    if (iss.fail()) return tl::unexpected<void>();
    result[i] = byte_value;
  }

  return result;
}

template <size_t length>
std::string BytesToHexString(const std::array<std::byte, length>& bytes) {
  std::stringstream output;
  output << std::hex << std::setfill('0');
  for (std::byte byte : bytes) {
    output << std::setw(2) << static_cast<int>(byte);
  }

  return output.str();
}

// template <size_t length>
// tl::expected<std::array<std::byte, length>, void> VariantHexStringToBytes(
//     const Variant& variant) {
//   if (!variant.isString()) return tl::unexpected<void>();

//   const std::string hex_string =
//       std::string(const_cast<Variant>(variant).asString().c_str());
//       tl::expected<std::array<std::byte, length>, void> result =
//       HexStringToBytes(hex_string); return result;
// }
