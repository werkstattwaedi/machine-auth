#pragma once

#include <iomanip>
#include <sstream>

#include "Particle.h"

template <size_t length>
std::optional<std::array<std::byte, length>> HexStringToBytes(
    const std::string& hex_string) {
  static_assert(length > 0, "Array must not be empty");

  if (hex_string.length() != 2 * length) return {};

  std::array<std::byte, length> result;
  std::istringstream iss(hex_string);
  iss >> std::hex;  // Set the stream to interpret input as hexadecimal

  for (size_t i = 0; i < length; ++i) {
    unsigned char byte_value;
    iss >> std::setw(2) >> byte_value;
    if (iss.fail()) return {};
    result[i] = std::byte{byte_value};
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

template <size_t length>
std::optional<std::array<std::byte, length>> VariantHexStringToBytes(
    Variant variant) {
  if (!variant.isString()) return {};

  std::string hex_string = std::string(variant.asString().c_str());

  return HexStringToBytes<length>(hex_string);
}
