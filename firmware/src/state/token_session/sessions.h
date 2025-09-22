#pragma once

#include "common.h"
#include "fbs/token_session_generated.h"

namespace oww::state::token_session {
class TokenSession;

class Sessions {
 public:
  void Begin();

  std::shared_ptr<TokenSession> GetSessionForToken(
      std::array<uint8_t, 7> tag_uid);

  std::shared_ptr<TokenSession> RegisterSession(
      fbs::TokenSessionT *session_data);

 private:
  std::vector<std::shared_ptr<TokenSession>> sessions_;

  void HandleSessionEvent(CloudEvent event);
};

}  // namespace oww::state::token_session
