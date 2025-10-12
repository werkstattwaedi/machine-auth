#pragma once

#include <map>

#include "common.h"
#include "fbs/token_session_generated.h"
#include "machine_state.h"

// Forward declaration from state namespace
namespace oww::state {
class TokenSession;
}

namespace oww::logic::session {

class Sessions {
 public:
  void Begin();
  void Loop();

  std::shared_ptr<oww::state::TokenSession> GetSessionForToken(
      std::array<uint8_t, 7> token_id);

  std::shared_ptr<oww::state::TokenSession> RegisterSession(
      fbs::TokenSessionT& session_data);

  void RemoveSession(std::array<uint8_t, 7> token_id);

 private:
  static Logger logger;
  std::map<std::array<uint8_t, 7>, std::shared_ptr<oww::state::TokenSession>>
      session_by_token;
  std::map<std::string, std::shared_ptr<oww::state::TokenSession>> session_by_id;

  void HandleSessionEvent(CloudEvent event);
};

}  // namespace oww::logic::session
