#pragma once

#include <memory>
#include <variant>

#include "maincontent.h"
#include "state/tag/tag_state.h"

namespace oww::ui {

class SessionStatus : public MainContent {
 public:
  SessionStatus(lv_obj_t* parent, std::shared_ptr<oww::state::State> state,
                UserInterface* ui);
  virtual ~SessionStatus();

  virtual void Render() override;
  virtual void OnActivate() override;
  virtual void OnDeactivate() override;
  virtual std::shared_ptr<ButtonDefinition> GetButtonDefinition() override;

 private:
  // UI Elements
  lv_obj_t* icon_container_;
  lv_obj_t* status_text_;

  // Current button definition - updated dynamically
  std::shared_ptr<ButtonDefinition> current_buttons_;

  // Current state tracking
  void* last_state_id_;

  // Helper methods
  void CreateNfcIconArea();
  void CreateStatusText();
  void UpdateForState(
      const std::shared_ptr<oww::state::tag::TagState> tag_state);
};

}  // namespace oww::ui
