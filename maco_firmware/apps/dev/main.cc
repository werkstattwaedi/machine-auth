// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "MAIN"

#include "pw_log/log.h"
#include "maco_firmware/system/system.h"

namespace {

void AppInit() {
  PW_LOG_INFO("MACO Dev Firmware initializing...");
  // TODO: Initialize modules and services here
}

}  // namespace

int main() {
  maco::system::Init(AppInit);
  // Init never returns
}
