// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// Place a variable in PSRAM on P2 (external SPI RAM).
///
/// WARNING: .psram.bss is NOT zeroed at boot. Always re-initialise
/// variables placed with this macro before use.
#ifdef __arm__
#define PSRAM_BSS __attribute__((section(".psram.bss")))
#else
#define PSRAM_BSS
#endif
