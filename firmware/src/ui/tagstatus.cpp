#include "tagstatus.h"

#include <variant>

namespace oww::ui {

using namespace oww::state;

TagStatus::TagStatus(lv_obj_t* parent, std::shared_ptr<oww::state::State> state)
    : Component(state) {
  root_ = lv_obj_create(parent);

  status_led = lv_led_create(root_);
  lv_obj_align(status_led, LV_ALIGN_LEFT_MID, 10, 20);
  lv_led_off(status_led);

  status_label = lv_label_create(root_);
  lv_obj_align(status_label, LV_ALIGN_LEFT_MID, 50, 20);
}

TagStatus::~TagStatus() { lv_obj_delete(root_); }

void TagStatus::Render() {
  auto current_state = state_->GetTagState();
  if (current_state == last_state_) return;

  last_state_ = current_state;
  String state_string = "?";
  boolean led_on = true;
  auto led_color = lv_palette_main(LV_PALETTE_GREY);

  std::visit(
      [&](auto&& arg) {
        using T = std::decay_t<decltype(arg)>;
        if constexpr (std::is_same_v<T, oww::state::tag::Idle>) {
          state_string = "Kein Tag";
          led_on = false;
        } else if constexpr (std::is_same_v<T, oww::state::tag::Detected>) {
          state_string = "Lese Tag";
          led_color = lv_palette_main(LV_PALETTE_DEEP_ORANGE);
        } else if constexpr (std::is_same_v<T, oww::state::tag::Authenticated>) {
          state_string = "OWW Tag";
          led_color = lv_palette_main(LV_PALETTE_ORANGE);
        } else if constexpr (std::is_same_v<T, oww::state::tag::Authorize>) {
          state_string = "Authorisiertes Tag";
          led_color = lv_palette_main(LV_PALETTE_GREEN);
        } else if constexpr (std::is_same_v<T, oww::state::tag::Unknown>) {
          state_string = "Unbekannte Karte";
        } else if constexpr (std::is_same_v<T, oww::state::tag::Personalize>) {

          
          state_string = "Personalisiere...";
          led_color = lv_palette_main(LV_PALETTE_LIGHT_BLUE);
        }
      },
      *last_state_);

  lv_label_set_text(status_label, state_string);
  lv_led_set_color(status_led, led_color);
  if (led_on) {
    lv_led_on(status_led);
  } else {
    lv_led_off(status_led);
  }
}

}  // namespace oww::ui