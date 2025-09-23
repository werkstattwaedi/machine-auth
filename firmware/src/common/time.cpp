
#include "time.h"

#include "Particle.h"

std::chrono::time_point<std::chrono::steady_clock> timeSinceBoot() {
  auto uptime_ms = std::chrono::milliseconds(System.millis());
  return std::chrono::time_point<std::chrono::steady_clock>(uptime_ms);
}

// Returns the current real world time, measured as unix time in seconds since
// epoch.
std::chrono::time_point<std::chrono::system_clock> timeUtc() {
  time_t particle_time_t = Time.now();
  auto duration_since_epoch = std::chrono::seconds(particle_time_t);
  return std::chrono::time_point<std::chrono::system_clock>(
      duration_since_epoch);
}