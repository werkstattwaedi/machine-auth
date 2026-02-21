// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/display/display_metrics.h"

#include <cstring>

#include "pw_metric/global.h"
#include "pw_metric/metric.h"

namespace maco::display::metrics {
namespace {

PW_METRIC_GROUP_GLOBAL(kGroup, "display");

PW_METRIC(kGroup, frames_rendered, "frames_rendered", 0u);
PW_METRIC(kGroup, last_frame_time_us, "last_frame_time_us", 0.0f);
PW_METRIC(kGroup, slow_frames, "slow_frames", 0u);
PW_METRIC(kGroup, flush_count, "flush_count", 0u);
PW_METRIC(kGroup, pixels_flushed, "pixels_flushed", 0u);
PW_METRIC(kGroup, dma_hangs, "dma_hangs", 0u);
PW_METRIC(kGroup, render_stack_free_words, "render_stack_free_words", 0u);

// Frames taking longer than 16 ms exceed a 60 FPS budget.
constexpr int64_t kSlowFrameThresholdUs = 16'000;

}  // namespace

void OnFrameRendered(int64_t elapsed_us) {
  frames_rendered.Increment();
  last_frame_time_us.Set(static_cast<float>(elapsed_us));
  if (elapsed_us > kSlowFrameThresholdUs) {
    slow_frames.Increment();
  }
}

void OnFlushRegion(int32_t w, int32_t h) {
  flush_count.Increment();
  pixels_flushed.Increment(static_cast<uint32_t>(w) *
                            static_cast<uint32_t>(h));
}

void OnDmaHang() { dma_hangs.Increment(); }

void OnThreadStackScan(const char* name, uint32_t free_words) {
  if (std::strcmp(name, "lvgl_render") == 0) {
    render_stack_free_words.Set(free_words);
  }
}

}  // namespace maco::display::metrics
