// Simulator-specific implementation of time functions

#include "common/time.h"

std::chrono::time_point<std::chrono::steady_clock> timeSinceBoot() {
  return std::chrono::steady_clock::now();
}

std::chrono::time_point<std::chrono::system_clock> timeUtc() {
  return std::chrono::system_clock::now();
}
