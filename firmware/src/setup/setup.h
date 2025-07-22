#pragma once

#include "Particle.h"
#include "state/state.h"

// complete separate part of the firmware to be stared in lieu of the actual
// firmware, to test HW and finalize setup.
namespace oww::setup {

void setup(std::shared_ptr<oww::state::State> state);
void loop(std::shared_ptr<oww::state::State> state);

}  // namespace oww::setup