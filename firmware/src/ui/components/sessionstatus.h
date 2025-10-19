#pragma once

#include <memory>
#include <variant>

#include "ui/components/screen.h"

namespace oww::ui {

class SessionStatus : public Screen {
 public:
  SessionStatus(lv_obj_t* parent, std::shared_ptr<state::IApplicationState> app,
                hal::IHardware* hardware = nullptr);
  virtual ~SessionStatus();

  virtual void Render() override;
  virtual void OnActivate() override;
  virtual void OnDeactivate() override;
  virtual std::shared_ptr<ButtonBarSpec> GetButtonBarSpec() const override;
  virtual std::shared_ptr<hal::ILedEffect> GetLedEffect() override;

 private:
  // UI Elements
  lv_obj_t* user_label_ = nullptr;
  lv_obj_t* icon_container_ = nullptr;
  lv_obj_t* status_text_ = nullptr;
  lv_obj_t* duration_label_ = nullptr;
  lv_obj_t* icon_ = nullptr;

  // Current button definition - updated dynamically
  mutable std::shared_ptr<ButtonBarSpec> current_buttons_;

  // Current state tracking
  void* last_state_id_ = nullptr;

  // LED effects for different machine states
  std::shared_ptr<hal::ILedEffect> idle_effect_;
  std::shared_ptr<hal::ILedEffect> active_effect_;
  std::shared_ptr<hal::ILedEffect> denied_effect_;
  std::shared_ptr<hal::ILedEffect> current_effect_;

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
