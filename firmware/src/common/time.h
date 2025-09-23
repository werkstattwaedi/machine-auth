#pragma once

#include <chrono>

// Returns time since boot, in millisecond accuracy.
std::chrono::time_point<std::chrono::steady_clock> timeSinceBoot();

// Returns the current real world time, measured as unix time in seconds since
// epoch.
std::chrono::time_point<std::chrono::system_clock> timeUtc();