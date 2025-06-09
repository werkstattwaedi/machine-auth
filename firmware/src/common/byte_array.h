#pragma once

#include <iomanip>
#include <optional>
#include <sstream>

#include "Particle.h"

template <typename... Ts>
std::array<uint8_t, sizeof...(Ts)> MakeBytes(Ts&&... args) noexcept {
  return {uint8_t(std::forward<Ts>(args))...};
}

template <size_t length>
std::optional<std::array<uint8_t, length>> MakeBytesFromHexString(
    const std::string& hex_string) {
  if (hex_string.length() != 2 * length) return {};
  std::array<uint8_t, length> result;

  for (size_t i = 0; i < length; ++i) {
    unsigned int byte_value;
    if (std::sscanf(hex_string.c_str() + 2 * i, "%2x", &byte_value) != 1) {
      return {};
    }
    result[i] = static_cast<uint8_t>(byte_value);
  }
  return result;
}

template <size_t length>
std::string ToHexString(const std::array<uint8_t, length>& bytes) {
  std::stringstream output;
  output << std::hex << std::setfill('0');
  for (uint8_t byte : bytes) {
    output << std::setw(2) << static_cast<int>(byte);
  }

  return output.str();
}

template <size_t length>
std::optional<std::array<uint8_t, length>> MakeBytesFromHexStringVariant(
    particle::Variant variant) {
  if (!variant.isString()) return {};

  std::string hex_string = std::string(variant.asString().c_str());

  return MakeBytesFromHexString<length>(hex_string);
}
