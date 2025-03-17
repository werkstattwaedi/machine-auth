#pragma once

#include "../common.h"
#include "../state/state.h"
#include "driver/Ntag424.h"
#include "driver/PN532.h"

struct NfcStateData;

class NfcStateHandler {
 public:

 std::shared_ptr<Ntag424> ntag();

 


};