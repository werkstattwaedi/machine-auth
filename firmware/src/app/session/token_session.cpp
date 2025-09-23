#include "token_session.h"

namespace oww::app::session {

TokenSession::TokenSession(const fbs::TokenSessionT& src, Sessions* sessions) {
  std::copy(src.token_id.get()->uid()->begin(),
            src.token_id.get()->uid()->end(), tag_uid_.begin());

  session_id_ = src.session_id.c_str();
  expiration_ = src.expiration * 1000;
  user_id_ = src.user_id.c_str();
  user_label_ = src.user_label.c_str();

  for (const auto& permission : src.permissions) {
    permissions_.push_back(permission.c_str());
  }
}

bool TokenSession::HasPermission(std::string permission) const {
  return std::find(permissions_.begin(), permissions_.end(), permission) !=
         permissions_.end();
}

}  // namespace oww::app::session