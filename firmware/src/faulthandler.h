#pragma once
#include <stdint.h>

namespace oww {
namespace fault {

/** Initializes crash handling, logs any retained crash info and replays
 * retained logs at boot. */
void Init();

}  // namespace fault
}  // namespace oww
