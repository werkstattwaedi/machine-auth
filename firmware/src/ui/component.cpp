#include "component.h"

namespace oww::ui {

Component::operator lv_obj_t*() { return root_; }
lv_obj_t* Component::Root() { return root_; }
}  // namespace oww::ui