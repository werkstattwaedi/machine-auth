#include "maincontent.h"
#include "ui.h"

namespace oww::ui {

MainContent::MainContent(lv_obj_t* parent, std::shared_ptr<oww::state::State> state, UserInterface* ui)
    : Component(state), ui_(ui) {
  root_ = lv_obj_create(parent);
  lv_obj_remove_style_all(root_);
  lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
  lv_obj_set_align(root_, LV_ALIGN_CENTER);
}

MainContent::~MainContent() {
  lv_obj_delete(root_);
}

void MainContent::Render() {
  // Default implementation - subclasses should override
}

void MainContent::PushContent(std::shared_ptr<MainContent> content) {
  ui_->PushContent(content);
}

void MainContent::PopContent() {
  ui_->PopContent();
}

}  // namespace oww::ui
