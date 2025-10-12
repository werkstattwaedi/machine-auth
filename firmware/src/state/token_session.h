#pragma once

#include <array>
#include <chrono>
#include <string>
#include <vector>

#include "fbs/token_session_generated.h"

namespace oww::state {

class TokenSession {
 public:
  explicit TokenSession(const fbs::TokenSessionT& src);

  bool IsActive() const {
    return expiration_ > std::chrono::system_clock::now();
  }

  std::array<uint8_t, 7> GetTokenId() const { return tag_uid_; }
  std::string GetSessionId() const { return session_id_; }
  std::string GetUserId() const { return user_id_; }
  std::string GetUserLabel() const { return user_label_; }
  const std::vector<std::string>& GetPermissions() const { return permissions_; }

  bool HasPermission(std::string permission) const;

 private:
  std::array<uint8_t, 7> tag_uid_;
  std::string session_id_;
  std::chrono::time_point<std::chrono::system_clock> expiration_;
  std::string user_id_;
  std::string user_label_;
  std::vector<std::string> permissions_;
};

}  // namespace oww::state
