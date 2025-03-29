#pragma once

#include <iomanip>
#include <optional>
#include <sstream>

#include "Particle.h"

template <typename... Ts>
std::array<std::byte, sizeof...(Ts)> MakeBytes(Ts&&... args) noexcept {
  return {std::byte(std::forward<Ts>(args))...};
}

template <size_t length>
std::optional<std::array<std::byte, length>> MakeBytesFromHexString(
    const std::string& hex_string) {
  if (hex_string.length() != 2 * length) return {};
  std::array<std::byte, length> result;

  for (size_t i = 0; i < length; ++i) {
    unsigned int byte_value;
    if (std::sscanf(hex_string.c_str() + 2 * i, "%2x", &byte_value) != 1) {
      return {};
    }
    result[i] = static_cast<std::byte>(byte_value);
  }
  return result;
}

template <size_t length>
std::string ToHexString(const std::array<std::byte, length>& bytes) {
  std::stringstream output;
  output << std::hex << std::setfill('0');
  for (std::byte byte : bytes) {
    output << std::setw(2) << static_cast<int>(byte);
  }

  return output.str();
}

template <size_t length>
std::optional<std::array<std::byte, length>> MakeBytesFromHexStringVariant(
    particle::Variant variant) {
  if (!variant.isString()) return {};

  std::string hex_string = std::string(variant.asString().c_str());

  return MakeBytesFromHexString<length>(hex_string);
}
