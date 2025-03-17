#pragma once

#include "../common.h"
#include "cloud_request.h"
#include "configuration.h"
#include "event/state_event.h"
#include "tag/state.h"

namespace oww::state {

class State : public event::IStateEvent, public CloudRequest {
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

 protected:
  virtual int DispatchTerminalResponse(String command, RequestId request_id,
                                       VariantMap& payload) override;

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