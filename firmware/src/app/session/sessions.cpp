#include "sessions.h"

#include "token_session.h"

namespace oww::app::session {

void Sessions::Begin() {
  SubscribeOptions subscribeOptions;
  subscribeOptions.structured(true);

  Particle.subscribe(
      "/sessions/", [this](CloudEvent event) { HandleSessionEvent(event); },
      subscribeOptions);
}

void Sessions::Loop() {}

std::shared_ptr<TokenSession> Sessions::GetSessionForToken(
    std::array<uint8_t, 7> token_id) {
  if (auto it = session_by_token.find(token_id); it != session_by_token.end()) {
    return it->second;
  } else {
    return nullptr;
  }
}

std::shared_ptr<TokenSession> Sessions::RegisterSession(
    fbs::TokenSessionT& session_data) {
  auto new_session = std::make_shared<TokenSession>(session_data, this);
  const auto token_id = new_session->GetTokenId();
  const auto session_id = new_session->GetSessionId();

  // Check for duplicate token id

  if (auto it = session_by_token.find(token_id); it != session_by_token.end()) {
    auto existing_session = it->second;
    if (session_id == existing_session->GetSessionId()) {
      // If we had racing RPCs, we could theoretically get the same session
      // again. Just use the already existing object.
      Log.warn("RegisterSession: Session %s was already registerd before",
               new_session->GetSessionId().c_str());
      return it->second;
    }

    // New session might be added if the previous one expired, or was already
    // closed by the user. Make sure to upload all pending
    // FIXME - do upload.
  }

  session_by_token[token_id] = new_session;
  session_by_id[session_id] = new_session;

  return new_session;
}

void Sessions::HandleSessionEvent(CloudEvent event) {}

}  // namespace oww::app::session