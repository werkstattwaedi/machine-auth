#pragma once

#include "Particle.h"
#include "logic/application.h"

// complete separate part of the firmware to be stared in lieu of the actual
// firmware, to test HW and finalize setup.
namespace oww::setup {

void setup(std::shared_ptr<oww::logic::Application> state);
void loop();

}  // namespace oww::setup