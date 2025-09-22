#include "sessions.h"

#include "token_session.h"

namespace oww::state::token_session {

void Sessions::Begin() {
  SubscribeOptions subscribeOptions;
  subscribeOptions.structured(true);

  Particle.subscribe(
      "/sessions/", [this](CloudEvent event) { HandleSessionEvent(event); },
      subscribeOptions);
}

std::shared_ptr<TokenSession> Sessions::GetSessionForToken(
    std::array<uint8_t, 7> tag_uid) {
  auto it = std::find_if(sessions_.begin(), sessions_.end(),
                         [&tag_uid](const auto& session) {
                           return session.second->GetTagUid() == tag_uid;
                         });

  return it != sessions_.end() ? *it : nullptr;
}

std::shared_ptr<TokenSession> Sessions::RegisterSession(
    fbs::TokenSessionT* session_data) {
  if (!session_data) {
    Log.warn("RegisterSession: null session_data");
    return nullptr;
  }

  auto new_session = std::make_shared<TokenSession>(*session_data);
  const auto token_id = new_session->GetTokenId();

  // Check for duplicate token id
  auto it = std::find_if(
      sessions_.begin(), sessions_.end(),
      [token_id](const auto& entry) { return entry.first == token_id; });
  if (it != sessions_.end()) {
    Log.warn("RegisterSession: session with token id already exists");
  }

  sessions_.emplace_back(token_id, new_session);
  return new_session;
}

void Sessions::HandleSessionEvent(CloudEvent event) {}

}  // namespace oww::state::token_session