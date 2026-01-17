// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <utility>

namespace maco::ui {

/// Dirty-flag wrapper for efficient LVGL updates.
/// Only updates LVGL widgets when data actually changed.
///
/// Usage:
///   Watched<std::string> title_{"Initial"};
///
///   void OnUpdate() {
///     if (title_.CheckAndClearDirty()) {
///       lv_label_set_text(label_, title_.Get().c_str());
///     }
///   }
template <typename T>
class Watched {
 public:
  explicit Watched(T initial) : value_(std::move(initial)), dirty_(true) {}

  /// Set new value. Only marks dirty if value actually changed.
  void Set(T new_value) {
    if (value_ != new_value) {
      value_ = std::move(new_value);
      dirty_ = true;
    }
  }

  /// Get current value (const reference).
  const T& Get() const { return value_; }

  /// Check if dirty and clear flag. Returns true if was dirty.
  bool CheckAndClearDirty() {
    if (dirty_) {
      dirty_ = false;
      return true;
    }
    return false;
  }

  /// Check if dirty without clearing.
  bool IsDirty() const { return dirty_; }

  /// Force mark as dirty (useful for initial render).
  void MarkDirty() { dirty_ = true; }

 private:
  T value_;
  bool dirty_;
};

}  // namespace maco::ui
