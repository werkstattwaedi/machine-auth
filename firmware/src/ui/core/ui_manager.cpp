#include "ui/core/ui_manager.h"
#include <array>

namespace oww::ui {

UiManager::UiManager(std::shared_ptr<state::IApplicationState> app,
                     hal::IHardware* hardware)
    : app_(app),
      hardware_(hardware),
      effect_manager_(std::make_unique<leds::EffectManager>(500)),
      multiplexer_(std::make_unique<leds::Multiplexer>()) {
  // Set up LED callback if hardware is available
  if (hardware_) {
    // Chain: Multiplexer combines effects → EffectManager adds crossfading
    hardware_->SetLedCallback(effect_manager_->GetEffect());
  }
}

void UiManager::PushContent(std::shared_ptr<MainContent> content) {
  if (!content_stack_.empty()) {
    content_stack_.back()->OnDeactivate();
    if (button_bar_ && content_stack_.back()->GetButtonDefinition()) {
      button_bar_->RemoveButtons(content_stack_.back()->GetButtonDefinition());
    }
  }

  content_stack_.push_back(content);
  ActivateContent(content);
}

void UiManager::PopContent() {
  if (content_stack_.size() <= 1) {
    return;  // Don't pop the last content
  }

  auto current = content_stack_.back();
  current->OnDeactivate();
  if (button_bar_ && current->GetButtonDefinition()) {
    button_bar_->RemoveButtons(current->GetButtonDefinition());
  }

  content_stack_.pop_back();

  if (!content_stack_.empty()) {
    ActivateContent(content_stack_.back());
  }
}

std::shared_ptr<MainContent> UiManager::GetCurrentContent() {
  if (content_stack_.empty()) {
    return nullptr;
  }
  return content_stack_.back();
}

void UiManager::SetButtonBar(ButtonBar* button_bar) {
  button_bar_ = button_bar;
}

void UiManager::UpdateLedEffects() {
  if (!hardware_) {
    return;
  }

  // Clear and rebuild multiplexed effect
  multiplexer_->Clear();

  // ButtonBar effect has priority (affects specific button LEDs)
  if (button_bar_) {
    auto button_effect = button_bar_->GetLedEffect();
    if (button_effect) {
      multiplexer_->AddEffect(button_effect);
    }
  }

  // MainContent effect is lower priority (usually affects all LEDs)
  if (!content_stack_.empty()) {
    auto content = content_stack_.back();
    auto content_effect = content->GetLedEffect();
    if (content_effect) {
      multiplexer_->AddEffect(content_effect);
    }
  }

  // Set the multiplexed effect (with crossfading)
  effect_manager_->SetEffect(multiplexer_->GetEffect(), false);
}

void UiManager::SetLedEffect(leds::LedEffect effect) {
  if (!hardware_ || !effect_manager_) {
    return;
  }

  // Directly set effect (bypassing multiplexer) for special cases
  effect_manager_->SetEffect(effect, false);
}

void UiManager::ActivateContent(std::shared_ptr<MainContent> content) {
  content->OnActivate();
  if (button_bar_ && content->GetButtonDefinition()) {
    button_bar_->ActivateButtons(content->GetButtonDefinition());
  }
}

void UiManager::DeactivateCurrentContent() {
  if (!content_stack_.empty()) {
    auto current = content_stack_.back();
    current->OnDeactivate();
    if (button_bar_ && current->GetButtonDefinition()) {
      button_bar_->RemoveButtons(current->GetButtonDefinition());
    }
  }
}

}  // namespace oww::ui
