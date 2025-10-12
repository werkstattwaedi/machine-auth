#pragma once

#include "common.h"
#include "fbs/personalization_generated.h"
#include "logic/cloud_request.h"
#include "nfc/nfc_tags.h"

// Forward declarations
namespace oww::logic {
class Application;
}  // namespace oww::logic

namespace oww::logic::action {

namespace personalize {

struct Begin {};

struct AwaitKeyDiversificationResponse {
  std::shared_ptr<state::CloudResponse<fbs::KeyDiversificationResponseT>> response;
};

struct DoPersonalizeTag {
  std::array<uint8_t, 16> application_key;
  std::array<uint8_t, 16> terminal_key;
  std::array<uint8_t, 16> card_key;
  std::array<uint8_t, 16> reserved_1_key;
  std::array<uint8_t, 16> reserved_2_key;
};

struct Completed {};

struct Failed {
  ErrorType error;
  std::string message;
};

using InternalState = std::variant<Begin, AwaitKeyDiversificationResponse,
                                   DoPersonalizeTag, Completed, Failed>;

}  // namespace personalize

class PersonalizeAction : public oww::nfc::NtagAction {
 public:
  PersonalizeAction(std::array<uint8_t, 7> tag_uid,
                    std::array<uint8_t, 16> terminal_key_,
                    std::weak_ptr<oww::logic::CloudRequest> cloud_request);

  virtual Continuation Loop(Ntag424& ntag_interface);
  virtual bool IsComplete();
  virtual void OnAbort(ErrorType error);

 private:
  std::array<uint8_t, 7> tag_uid_;
  std::array<uint8_t, 16> terminal_key_;
  std::weak_ptr<oww::logic::CloudRequest> cloud_request_;
  std::shared_ptr<personalize::InternalState> state_;
};

}  // namespace oww::logic::action