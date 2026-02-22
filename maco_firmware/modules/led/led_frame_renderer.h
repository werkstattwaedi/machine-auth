// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

namespace maco::led {

/// Interface for per-frame LED animation callbacks.
/// Implement this and register via Led::set_frame_renderer().
/// OnFrame() is called once per frame from the Led render thread,
/// before the driver's Show() pushes pixels to hardware.
class LedFrameRenderer {
 public:
  virtual ~LedFrameRenderer() = default;
  /// Called once per frame from the Led render thread.
  /// @param dt_s  Time elapsed since last frame, in seconds.
  ///              Capped at kMaxDt to handle startup jitter.
  virtual void OnFrame(float dt_s) = 0;
};

}  // namespace maco::led
