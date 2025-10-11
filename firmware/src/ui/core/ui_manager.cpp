#include "ui/core/ui_manager.h"

namespace oww::ui {

UiManager::UiManager(std::shared_ptr<state::IApplicationState> app)
    : app_(app) {}

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
