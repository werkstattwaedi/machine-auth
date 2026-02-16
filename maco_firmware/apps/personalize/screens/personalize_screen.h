// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>

#include "maco_firmware/modules/ui/data_binding.h"
#include "maco_firmware/modules/ui/screen.h"
#include "pw_string/string_builder.h"

namespace maco::personalize {

/// Personalization state visible to the screen.
enum class PersonalizeStateId {
  kIdle,
  kProbing,
  kFactoryTag,
  kMacoTag,
  kUnknownTag,
  kAwaitingTag,
  kPersonalizing,
  kPersonalized,
  kError,
};

/// Snapshot of tag prober state for the UI thread.
struct PersonalizeSnapshot {
  PersonalizeStateId state = PersonalizeStateId::kIdle;
  std::array<std::byte, 7> uid{};
  size_t uid_size = 0;
  pw::InlineString<128> error_message;
};

/// Function type for fetching personalize state.
using PersonalizeSnapshotProvider = void (*)(PersonalizeSnapshot&);

/// Screen showing tag personalization status.
/// Uses OnUpdate() to poll the tag prober via a snapshot provider,
/// independent of the AppState system.
class PersonalizeScreen : public ui::Screen {
 public:
  explicit PersonalizeScreen(PersonalizeSnapshotProvider provider);

  pw::Status OnActivate() override;
  void OnDeactivate() override;
  void OnUpdate(const app_state::AppStateSnapshot& snapshot) override;
  ui::ButtonConfig GetButtonConfig() const override;

 private:
  void UpdateStatusText(const PersonalizeSnapshot& snapshot);
  static void FormatUidTo(pw::StringBuilder& out,
                          const std::array<std::byte, 7>& uid,
                          size_t size);

  PersonalizeSnapshotProvider snapshot_provider_;
  lv_obj_t* status_label_ = nullptr;

  ui::Watched<PersonalizeStateId> state_watched_{
      PersonalizeStateId::kIdle};
  PersonalizeSnapshot last_snapshot_;
  pw::StringBuffer<128> status_text_;
};

}  // namespace maco::personalize
