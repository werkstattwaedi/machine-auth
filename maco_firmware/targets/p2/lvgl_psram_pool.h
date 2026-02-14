// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// LVGL memory pool placed in PSRAM via linker section attribute.
// Included by LVGL via LV_MEM_POOL_INCLUDE in lv_conf.h.

#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

static inline void* lvgl_psram_pool_alloc(size_t size) {
  // .psram.bss is NOT zeroed by module_user_pre_init() (it only zeroes SRAM
  // .bss). This is safe for LVGL because TLSF initializes its own metadata
  // over the pool. Other variables placed in .psram.bss may contain stale data.
  __attribute__((section(".psram.bss")))
  static uint8_t pool[64 * 1024];
  // LVGL's TLSF allocator manages the pool internally; it passes the
  // configured LV_MEM_SIZE here, but we ignore it since we provide a
  // fixed backing buffer.
  (void)size;
  return pool;
}

#ifdef __cplusplus
}
#endif
