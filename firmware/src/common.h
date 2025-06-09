#pragma once

// Main include file for all machine-auth-firmware related files.

#include "Particle.h"
#include "common/debug.h"
#include "common/expected.h"
#include "common/status.h"
#include "config.h"

// Helper type for overloaded std::variant visit 
template <class... Ts>
struct overloaded : Ts... {
  using Ts::operator()...;
};
template <class... Ts>
overloaded(Ts...) -> overloaded<Ts...>;
