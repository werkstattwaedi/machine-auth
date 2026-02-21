// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

namespace maco::display::metrics {

// Called each time lv_timer_handler() completes. elapsed_us is the duration
// of the handler call in microseconds.
void OnFrameRendered(int64_t elapsed_us);

// Called each time LVGL flushes a dirty region to the display.
void OnFlushRegion(int32_t w, int32_t h);

// Called when a DMA transfer times out on the P2 driver.
void OnDmaHang();

// Plain-function-pointer callback for stack_monitor's ThreadWatermarkCallback.
// Updates render_stack_free_words when name matches the render thread.
void OnThreadStackScan(const char* name, uint32_t free_words);

}  // namespace maco::display::metrics
