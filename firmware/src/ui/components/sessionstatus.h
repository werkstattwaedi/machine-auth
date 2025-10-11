#pragma once

#include <memory>
#include <variant>

#include "ui/components/maincontent.h"

namespace oww::ui {

class SessionStatus : public MainContent {
 public:
  SessionStatus(lv_obj_t* parent, std::shared_ptr<state::IApplicationState> app,
                hal::IHardware* hardware = nullptr);
  virtual ~SessionStatus();

  virtual void Render() override;
  virtual void OnActivate() override;
  virtual void OnDeactivate() override;
  virtual std::shared_ptr<ButtonDefinition> GetButtonDefinition() override;

 private:
  // UI Elements
  lv_obj_t* icon_container_;
  lv_obj_t* status_text_;
  lv_obj_t* user_label_;
  lv_obj_t* duration_label_;
  lv_obj_t* icon_;

  // Current button definition - updated dynamically
  std::shared_ptr<ButtonDefinition> current_buttons_;

  // Current state tracking
  void* last_state_id_;

  // Setup methods
  void CreateNfcIconArea();
  void CreateStatusText();

  // State rendering methods
  void RenderIdleState();
  void RenderActiveState(const state::machine::Active& active);
  void RenderDeniedState(const state::machine::Denied& denied);
  void UpdateButtonsForState();

  // Helper methods
  std::string FormatDuration(std::chrono::seconds elapsed);
};

}  // namespace oww::ui
