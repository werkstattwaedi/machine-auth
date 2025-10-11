
#pragma once

#ifdef SIMULATOR_BUILD
#include <cstdio>
#include <string>

// Stub Logger for simulator
class Logger {
 public:
  explicit Logger(const char* name) : name_(name) {}

  template<typename... Args>
  void trace(const char* fmt, Args... args) {
    printf("[%s] TRACE: ", name_.c_str());
    printf(fmt, args...);
    printf("\n");
  }

  template<typename... Args>
  void info(const char* fmt, Args... args) {
    printf("[%s] INFO: ", name_.c_str());
    printf(fmt, args...);
    printf("\n");
  }

  template<typename... Args>
  void warn(const char* fmt, Args... args) {
    printf("[%s] WARN: ", name_.c_str());
    printf(fmt, args...);
    printf("\n");
  }

  template<typename... Args>
  void error(const char* fmt, Args... args) {
    fprintf(stderr, "[%s] ERROR: ", name_.c_str());
    fprintf(stderr, fmt, args...);
    fprintf(stderr, "\n");
  }

 private:
  std::string name_;
};

#define DLOG(fmt, ...) printf("%s:%d " fmt "\n", __FILE__, __LINE__, ##__VA_ARGS__)

#else

#include "Particle.h"

#define DLOG(fmt, ...) Log.warn("%s:%d " fmt, __FILE__, __LINE__, ##__VA_ARGS__)

#endif

#ifndef SIMULATOR_BUILD
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
String BytesToHexAndAsciiString(const uint8_t* data, const size_t num_bytes);

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
String BytesToHexString(const uint8_t* data, const size_t num_bytes);
#endif
