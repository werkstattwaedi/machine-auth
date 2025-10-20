#include "ui/core/ui_manager.h"

#include <array>

#include "state/system_state.h"
#include "ui/components/buttonbar.h"
#include "ui/components/sessionstatus.h"
#include "ui/components/splashscreen.h"
#include "ui/components/statusbar.h"
namespace oww::ui {

UiManager::UiManager(std::shared_ptr<state::IApplicationState> app,
                     hal::IHardware* hardware, lv_obj_t* root_screen,
                     std::string machine_label)
    : app_(app),
      hardware_(hardware),
      root_screen_(root_screen),
      machine_label_(machine_label),
      crossfade_(std::make_shared<leds::Crossfade>(500)),
      multiplexer_(std::make_shared<leds::Multiplexer>()) {
  // Set up LED callback if hardware is available
  if (hardware_) {
    // Create a lambda that bridges to root crossfade's GetLeds method
    hardware_->SetLedEffect(crossfade_);
  }

  // Auto-create splash screen during boot
  // FIXME - the initia update crashed during boot - but its also not needed
  // UpdateScreenForSystemState();
}

void UiManager::PushScreen(std::shared_ptr<Screen> screen) {
  if (!screen_stack_.empty()) {
    screen_stack_.back()->OnDeactivate();
    if (button_bar_ && screen_stack_.back()->GetButtonBarSpec()) {
      button_bar_->RemoveButtons(screen_stack_.back()->GetButtonBarSpec());
    }
  }

  screen_stack_.push_back(screen);
  ActivateScreen(screen);
}

void UiManager::PopScreen() {
  if (screen_stack_.size() <= 1) {
    return;  // Don't pop the last screen
  }

  auto current = screen_stack_.back();
  current->OnDeactivate();
  if (button_bar_ && current->GetButtonBarSpec()) {
    button_bar_->RemoveButtons(current->GetButtonBarSpec());
  }

  screen_stack_.pop_back();

  if (!screen_stack_.empty()) {
    ActivateScreen(screen_stack_.back());
  }
}

std::shared_ptr<Screen> UiManager::GetCurrentScreen() {
  if (screen_stack_.empty()) {
    return nullptr;
  }
  return screen_stack_.back();
}

bool UiManager::IsBooting() const { return splash_screen_ != nullptr; }

void UiManager::Loop() {
  // Phase 5: Auto screen management
  UpdateScreenForSystemState();

  // Render active screen
  RenderCurrentScreen();

  // Update LED effects
  UpdateLedEffects();
}

void UiManager::UpdateScreenForSystemState() {
  auto system_state = app_->GetSystemState();

  if (std::holds_alternative<state::system::Booting>(*system_state)) {
    // Still booting - ensure splash screen exists
    if (!splash_screen_) {
      splash_screen_ =
          std::make_shared<SplashScreen>(root_screen_, app_, hardware_);
    }

  } else if (std::holds_alternative<state::system::Ready>(*system_state)) {
    // Boot complete - transition to main UI
    if (splash_screen_) {
      splash_screen_ = nullptr;  // Destroy splash screen
      CreateMainUI();
    } else if (screen_stack_.empty()) {
      // System is Ready but we never created splash AND have no screens
      // This happens if system booted very fast before first Loop() call
      CreateMainUI();
    }
  }
}

void UiManager::CreateMainUI() {
  // Create status bar at top
  status_bar_ = std::make_unique<StatusBar>(root_screen_, app_, machine_label_);
  lv_obj_set_size(*status_bar_, 240, 58);
  lv_obj_align(*status_bar_, LV_ALIGN_TOP_LEFT, 0, 0);

  // Create button bar at bottom
  button_bar_ = std::make_unique<ButtonBar>(root_screen_, app_, hardware_);

  // Create content container (between status and button bars)
  content_container_ = lv_obj_create(root_screen_);
  lv_obj_remove_style_all(content_container_);
  lv_obj_set_size(content_container_, 240, 212);  // 320 - 58 - 50
  lv_obj_align(content_container_, LV_ALIGN_TOP_LEFT, 0, 58);

  // Create and activate initial screen (SessionStatus)
  auto session_status =
      std::make_shared<SessionStatus>(content_container_, app_, hardware_);
  PushScreen(session_status);
}

void UiManager::RenderCurrentScreen() {
  if (splash_screen_) {
    // During boot: show splash only
    splash_screen_->Render();
    return;
  }

  // Main UI: render chrome and current screen
  auto current = GetCurrentScreen();
  if (!current) return;

  // Update status bar visibility
  if (status_bar_) {
    auto status_spec = current->GetStatusBarSpec();
    if (status_spec) {
      lv_obj_clear_flag(*status_bar_, LV_OBJ_FLAG_HIDDEN);
      status_bar_->Render();
    } else {
      lv_obj_add_flag(*status_bar_, LV_OBJ_FLAG_HIDDEN);
    }
  }

  // Update button bar visibility and configuration
  if (button_bar_) {
    auto button_spec = current->GetButtonBarSpec();
    if (button_spec) {
      lv_obj_clear_flag(button_bar_->GetRoot(), LV_OBJ_FLAG_HIDDEN);
      button_bar_->ActivateButtons(button_spec);
      button_bar_->Render();
    } else {
      lv_obj_add_flag(button_bar_->GetRoot(), LV_OBJ_FLAG_HIDDEN);
    }
  }

  // Render the screen itself
  current->Render();
}

void UiManager::UpdateLedEffects() {
  if (!hardware_) {
    return;
  }

  // Get current effects from components
  std::shared_ptr<hal::ILedEffect> button_effect = nullptr;
  std::shared_ptr<hal::ILedEffect> content_effect = nullptr;

  // During boot, show splash screen effect only
  if (splash_screen_) {
    content_effect = splash_screen_->GetLedEffect();
  } else {
    // Normal operation: get effects from button bar and content
    if (button_bar_) {
      button_effect = button_bar_->GetLedEffect();
    }

    if (!screen_stack_.empty()) {
      auto screen = screen_stack_.back();
      content_effect = screen->GetLedEffect();
    }
  }

  // Check if effects changed using pointer comparison
  bool effects_changed = (button_effect != current_button_effect_ ||
                          content_effect != current_content_effect_);

  if (effects_changed) {
    // Update tracked effects
    current_button_effect_ = button_effect;
    current_content_effect_ = content_effect;

    // Build effect vector (priority order: button bar first, content second)
    std::vector<std::shared_ptr<hal::ILedEffect>> effects;
    if (button_effect) {
      effects.push_back(button_effect);
    }
    if (content_effect) {
      effects.push_back(content_effect);
    }

    // Update multiplexer
    multiplexer_->SetEffects(effects);

    // Set the multiplexed effect (with crossfading)
    // Cast unique_ptr to shared_ptr for the effect manager
    std::shared_ptr<hal::ILedEffect> mux_effect =
        std::shared_ptr<hal::ILedEffect>(multiplexer_.get(),
                                         [](hal::ILedEffect*) {});
    crossfade_->SetEffect(mux_effect, false);
  }
}

void UiManager::ActivateScreen(std::shared_ptr<Screen> screen) {
  screen->OnActivate();
  if (button_bar_ && screen->GetButtonBarSpec()) {
    button_bar_->ActivateButtons(screen->GetButtonBarSpec());
  }
}

void UiManager::DeactivateCurrentScreen() {
  if (!screen_stack_.empty()) {
    auto current = screen_stack_.back();
    current->OnDeactivate();
    if (button_bar_ && current->GetButtonBarSpec()) {
      button_bar_->RemoveButtons(current->GetButtonBarSpec());
    }
  }
}

}  // namespace oww::ui
