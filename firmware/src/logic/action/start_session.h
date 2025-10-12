#pragma once

#include "common.h"
#include "fbs/token_session_generated.h"
#include "logic/cloud_request.h"
#include "nfc/nfc_tags.h"
#include "state/session_creation.h"

namespace oww::logic::session {
class TokenSession;
class Sessions;
}  // namespace oww::logic::session

namespace oww::logic::action {

class StartSessionAction : public oww::nfc::NtagAction {
 public:
  StartSessionAction(std::array<uint8_t, 7> tag_uid,
                     std::weak_ptr<oww::logic::CloudRequest> cloud_request,
                     std::weak_ptr<oww::logic::session::Sessions> sessions);
  ~StartSessionAction() {}

  virtual Continuation Loop(Ntag424& ntag_interface);
  virtual void OnAbort(ErrorType error);

  bool IsComplete();
  state::session_creation::SessionCreationStateHandle GetState() const {
    return state_machine_->GetStateHandle();
  }

 private:
  void RegisterStateHandlers();

  std::array<uint8_t, 7> tag_uid_;

  // Strong references - keep dependencies alive for action lifetime
  std::shared_ptr<oww::logic::CloudRequest> cloud_request_;
  std::shared_ptr<oww::logic::session::Sessions> sessions_;

  // Ntag interface reference (valid only during Loop())
  Ntag424* ntag_interface_ = nullptr;

  std::shared_ptr<state::session_creation::SessionCreationStateMachine> state_machine_;
};

}  // namespace oww::logic::action
