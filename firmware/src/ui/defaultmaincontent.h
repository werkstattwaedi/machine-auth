#pragma once

#include "maincontent.h"

namespace oww::ui {

class DefaultMainContent : public MainContent {
 public:
  DefaultMainContent(lv_obj_t* parent, std::shared_ptr<oww::state::State> state, UserInterface* ui);
  virtual ~DefaultMainContent();

  virtual void Render() override;
  virtual std::shared_ptr<ButtonDefinition> GetButtonDefinition() override;

 private:
  lv_obj_t* tag_status_container_;
  lv_obj_t* status_label_;
  std::shared_ptr<ButtonDefinition> button_definition_;
};

}  // namespace oww::ui
