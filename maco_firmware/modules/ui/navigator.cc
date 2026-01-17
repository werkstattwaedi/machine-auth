// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/ui/navigator.h"

#include "maco_firmware/modules/ui/widgets/button_bar.h"
#include "pw_log/log.h"

namespace maco::ui {

Navigator::Navigator(display::Display& display) : display_(display) {}

Navigator::~Navigator() {
  // Deactivate and clear all screens
  while (!stack_.empty()) {
    DeactivateScreen(stack_.back().get());
    stack_.pop_back();
  }
}

pw::Status Navigator::Init() {
  // Create button bar on lv_layer_top (persistent across screens)
  button_bar_ = std::make_unique<ButtonBar>(lv_layer_top());

  // Register update callback with display
  display_.SetUpdateCallback([this]() { Update(); });

  PW_LOG_INFO("Navigator initialized");
  return pw::OkStatus();
}

pw::Status Navigator::Push(std::unique_ptr<Screen> screen) {
  if (stack_.full()) {
    PW_LOG_ERROR("Navigation stack full");
    return pw::Status::ResourceExhausted();
  }

  // Deactivate current screen (if any)
  if (!stack_.empty()) {
    DeactivateScreen(stack_.back().get());
  }

  // Add new screen and activate
  Screen* new_screen = screen.get();
  stack_.push_back(std::move(screen));
  ActivateScreen(new_screen);

  PW_LOG_INFO("Pushed screen: %s", new_screen->debug_name().data());
  return pw::OkStatus();
}

pw::Status Navigator::Pop() {
  if (stack_.size() <= 1) {
    PW_LOG_WARN("Cannot pop last screen");
    return pw::Status::FailedPrecondition();
  }

  // Deactivate and remove current screen
  DeactivateScreen(stack_.back().get());
  PW_LOG_INFO("Popped screen: %s", stack_.back()->debug_name().data());
  stack_.pop_back();

  // Activate previous screen
  ActivateScreen(stack_.back().get());

  return pw::OkStatus();
}

pw::Status Navigator::Replace(std::unique_ptr<Screen> screen) {
  if (stack_.empty()) {
    return Push(std::move(screen));
  }

  // Deactivate and remove current screen
  DeactivateScreen(stack_.back().get());
  stack_.pop_back();

  // Add new screen and activate
  Screen* new_screen = screen.get();
  stack_.push_back(std::move(screen));
  ActivateScreen(new_screen);

  PW_LOG_INFO("Replaced with screen: %s", new_screen->debug_name().data());
  return pw::OkStatus();
}

pw::Status Navigator::Reset(std::unique_ptr<Screen> screen) {
  // Deactivate and clear all screens
  while (!stack_.empty()) {
    DeactivateScreen(stack_.back().get());
    stack_.pop_back();
  }

  // Add new root screen and activate
  Screen* new_screen = screen.get();
  stack_.push_back(std::move(screen));
  ActivateScreen(new_screen);

  PW_LOG_INFO("Reset to screen: %s", new_screen->debug_name().data());
  return pw::OkStatus();
}

void Navigator::Update() {
  // Update chrome
  UpdateChrome();

  // Update current screen
  if (Screen* screen = current_screen()) {
    screen->OnUpdate();
  }
}

Screen* Navigator::current_screen() const {
  if (stack_.empty()) {
    return nullptr;
  }
  return stack_.back().get();
}

void Navigator::ActivateScreen(Screen* screen) {
  if (!screen) {
    return;
  }

  // Call screen's activate hook (creates LVGL widgets)
  pw::Status status = screen->OnActivate();
  if (!status.ok()) {
    PW_LOG_ERROR("Screen activation failed: %s", screen->debug_name().data());
    return;
  }

  // Load the LVGL screen with animation
  if (screen->lv_screen()) {
    lv_screen_load_anim(
        screen->lv_screen(), LV_SCREEN_LOAD_ANIM_FADE_IN, 200, 0, false);
  }

  // Set the active input group
  if (screen->lv_group()) {
    active_group_ = screen->lv_group();
    lv_indev_t* indev = lv_indev_get_next(nullptr);
    if (indev) {
      lv_indev_set_group(indev, active_group_);
    }
  }

  // Update chrome to reflect new screen
  UpdateChrome();
}

void Navigator::DeactivateScreen(Screen* screen) {
  if (!screen) {
    return;
  }

  screen->OnDeactivate();

  // Note: LVGL screen object will be deleted when unique_ptr is destroyed
}

void Navigator::UpdateChrome() {
  if (!button_bar_) {
    return;
  }

  // Get button config from current screen
  ButtonConfig config;
  if (Screen* screen = current_screen()) {
    config = screen->GetButtonConfig();
  }

  button_bar_->SetConfig(config);
  button_bar_->Update();
}

void Navigator::HandleEscapeKey() {
  Screen* screen = current_screen();
  if (!screen) {
    return;
  }

  // Let screen handle ESC first
  if (screen->OnEscapePressed()) {
    return;
  }

  // Default: pop the screen
  (void)Pop();
}

}  // namespace maco::ui
