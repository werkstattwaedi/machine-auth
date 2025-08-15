#include "defaultmaincontent.h"

namespace oww::ui {

DefaultMainContent::DefaultMainContent(lv_obj_t* parent, std::shared_ptr<oww::state::State> state, UserInterface* ui)
    : MainContent(parent, state, ui) {
  
  // Create container for tag status (similar to the original TagStatus component)
  tag_status_container_ = lv_obj_create(root_);
  lv_obj_remove_style_all(tag_status_container_);
  lv_obj_set_size(tag_status_container_, LV_PCT(100), LV_PCT(100));
  lv_obj_center(tag_status_container_);
  
  // Create status label
  status_label_ = lv_label_create(tag_status_container_);
  lv_obj_center(status_label_);
  lv_label_set_text(status_label_, "Ready");
  
  // Create button definition with example buttons
  button_definition_ = std::make_shared<ButtonDefinition>();
  button_definition_->left_label = "Help";
  button_definition_->left_enabled = true;
  button_definition_->left_color = lv_color32_make(255, 153, 0, 255); // Orange
  
  button_definition_->right_label = "Menu";
  button_definition_->right_enabled = true;
  button_definition_->right_color = lv_color32_make(0, 170, 0, 255); // Green
  
  button_definition_->up_enabled = true;
  button_definition_->down_enabled = true;
}

DefaultMainContent::~DefaultMainContent() {
  // Cleanup handled by parent destructor
}

void DefaultMainContent::Render() {
  // Update the status label based on current state
  auto terminal_state = state_->GetTerminalState();
  
  if (terminal_state) {
    using namespace oww::state::terminal;
    
    std::string status_text = "Unknown";
    
    std::visit(overloaded{
                   [&](Idle state) { status_text = "Ready for tag"; },
                   [&](Detected state) { status_text = "Tag detected"; },
                   [&](Authenticated state) { status_text = "Authenticated"; },
                   [&](StartSession state) { status_text = "Starting session"; },
                   [&](Unknown state) { status_text = "Unknown tag"; },
                   [&](Personalize state) { status_text = "Personalizing"; },
               },
               *(terminal_state.get()));
    
    lv_label_set_text(status_label_, status_text.c_str());
  }
}

std::shared_ptr<ButtonDefinition> DefaultMainContent::GetButtonDefinition() {
  return button_definition_;
}

}  // namespace oww::ui
