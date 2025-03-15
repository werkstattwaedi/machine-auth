#pragma once

#include "../common.h"
#include "configuration.h"
#include "event/state_event.h"
#include "cloud_request.h"
#include "tag/state.h"

namespace oww::state {

class State : public event::IStateEvent, public CloudRequest  {
 public:
  Status Begin(std::unique_ptr<Configuration> configuration);

  void Loop();

  Configuration* GetConfiguration() { return configuration_.get(); }

  std::shared_ptr<tag::State> GetTagState() { return tag_state_; }

 public:
  os_mutex_t mutex_ = 0;
  void lock() { os_mutex_lock(mutex_); };
  bool tryLock() { return os_mutex_trylock(mutex_); };
  void unlock() { os_mutex_unlock(mutex_); };

 private:
  static Logger logger;

  std::unique_ptr<Configuration> configuration_ = nullptr;
  std::shared_ptr<tag::State> tag_state_;

 private:
  void AuthorizationLoop(tag::Authorize& authorize_state);
  bool AuthorizationResponse(RequestId requestId, Variant payload);

  std::optional<tag::Personalize> PersonalizationLoop(
      tag::Personalize personalize_state);
  tl::expected<tag::Personalize, ErrorType> PersonalizationResponse(
      RequestId requestId, Variant payload);

 private:
  int request_counter_ = 1;
  tl::expected<RequestId, ErrorType> SendTerminalRequest(String command,
                                                         Variant& payload);
  int ProcessTerminalResponse(String response_payload);

 public:
  virtual void OnConfigChanged() override;

  virtual void OnTagFound() override;
  virtual void OnBlankNtag(std::array<std::byte, 7> uid) override;
  virtual void OnUnknownTag() override;
  virtual void OnTagRemoved() override;
  virtual void OnTagAuthenicated(std::array<std::byte, 7> uid) override;
};

}  // namespace oww::state