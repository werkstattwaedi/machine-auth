
#include "debug.h"

String BytesToHexAndAsciiString(const uint8_t *data, const size_t num_bytes) {
  String output_string = BytesToHexString(data, num_bytes) + "  ";

  // ASCII part.
  for (size_t i = 0; i < num_bytes; ++i) {
    if (data[i] >= 0x20 && data[i] <= 0x7E) {
      // Printable ASCII character.
      char ascii_chars[] = {data[i], '\0'};
      output_string += ascii_chars;
    } else {
      // Non-printable character, represent with a dot.
      output_string += ".";
    }
  }

  return output_string;
}

String BytesToHexString(const uint8_t *data, const size_t num_bytes) {
  String output_string;

  for (size_t i = 0; i < num_bytes; ++i) {
    char hex_chars[4];
    snprintf(hex_chars, sizeof(hex_chars), "%02X ", data[i]);
    output_string += hex_chars;
  }

  return output_string.trim();
}