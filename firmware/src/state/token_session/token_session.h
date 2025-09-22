#pragma once

#include "common.h"
#include "fbs/token_session_generated.h"

namespace oww::state::token_session {

class TokenSession {
 public:
  TokenSession(const fbs::TokenSessionT& src);

  bool IsActive() const { return expiration_ > millis(); }
  std::array<uint8_t, 7> GetTokenId() const { return tag_uid_; }
  std::string GetUserId() const { return user_id_; }
  std::string GetUserLabel() const { return user_label_; }

  bool HasPermission(std::string permission) const;

 private:
  std::array<uint8_t, 7> tag_uid_;
  std::string session_id_;
  system_tick_t expiration_;
  std::string user_id_;
  std::string user_label_;
  std::vector<std::string> permissions_;
};

}  // namespace oww::state::token_session
