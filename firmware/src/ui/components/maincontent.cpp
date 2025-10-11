#include "ui/components/maincontent.h"

#include "ui/platform/maco_ui.h"

namespace oww::ui {

MainContent::MainContent(lv_obj_t* parent,
                         std::shared_ptr<oww::logic::Application> state,
                         UserInterface* ui)
    : Component(state), ui_(ui) {
  root_ = lv_obj_create(parent);
  lv_obj_remove_style_all(root_);
  lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
  lv_obj_set_align(root_, LV_ALIGN_CENTER);
  lv_obj_add_flag(root_, LV_OBJ_FLAG_HIDDEN);
}

MainContent::~MainContent() { lv_obj_delete(root_); }

void MainContent::OnActivate() { lv_obj_clear_flag(root_, LV_OBJ_FLAG_HIDDEN); }

/** Called when this content becomes inactive */
void MainContent::OnDeactivate() { lv_obj_add_flag(root_, LV_OBJ_FLAG_HIDDEN); }

void MainContent::Render() {
  // Default implementation - subclasses should override
}

void MainContent::PushContent(std::shared_ptr<MainContent> content) {
  ui_->PushContent(content);
}

void MainContent::PopContent() { ui_->PopContent(); }

}  // namespace oww::ui
