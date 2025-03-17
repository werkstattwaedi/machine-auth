#pragma once

#include "../../common.h"
#include "nfc/driver/Ntag424.h"
#include "state/cloud_request.h"

namespace oww::state::tag {

namespace authorize {

struct Start {
  // Processed on NFC thread
  Ntag424Key key_number;
};

struct NtagChallenge {
  // Processed on State thread
  std::array<std::byte, 16> auth_challenge;
};

struct AwaitCloudChallenge {
  const RequestId request_id = RequestId::kInvalid;
};

struct AwaitAuthPart2Response {
  const RequestId request_id = RequestId::kInvalid;
};

struct Succeeded {};

struct Rejected {};

struct Failed {
  Ntag424::DNA_StatusCode tag_status;
};
using State = std::variant<Start, NtagChallenge, AwaitCloudChallenge,
                           AwaitAuthPart2Response, Succeeded, Rejected, Failed>;

}  // namespace authorize

struct Authorize {
  std::array<std::byte, 7> tag_uid;
  std::shared_ptr<authorize::State> state;

  Authorize WithNestedState(authorize::State nested_state);
};

std::optional<Authorize> StateLoop(Authorize authorize_state,
                                   CloudRequest &cloud_interface);
std::optional<Authorize> NfcLoop(Authorize authorize_state,
                                 Ntag424 &ntag_interface);
std::optional<Authorize> ProcessResponse(Authorize state, RequestId requestId,
                                         Variant payload);

}  // namespace oww::state::tag