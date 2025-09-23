#pragma once

#include <map>

#include "common.h"
#include "fbs/token_session_generated.h"

namespace oww::state::session {
class TokenSession;

class Sessions {
 public:
  void Begin();

  std::shared_ptr<TokenSession> GetSessionForToken(
      std::array<uint8_t, 7> token_id);

  std::shared_ptr<TokenSession> RegisterSession(
      fbs::TokenSessionT &session_data);

 private:
  std::map<std::array<uint8_t, 7>, std::shared_ptr<TokenSession>> session_by_token;
  std::map<std::string, std::shared_ptr<TokenSession>> session_by_id;

  void HandleSessionEvent(CloudEvent event);
};

}  // namespace oww::state::session
