#pragma once

#include "../../common.h"
#include "../cloud_request.h"
#include "nfc/driver/Ntag424.h"

namespace oww::state::tag {

namespace authorize {

struct Start {
  Ntag424Key key_number;

  State Process(Ntag424 &ntag_interface);
};

struct NtagChallenge {
  std::array<std::byte, 16> auth_challenge;

  State Process(
    std::array<std::byte, 7> tag_uid,
    CloudRequest &cloud_interface);
};

struct AwaitCloudChallenge {
  const RequestId request_id = RequestId::kInvalid;
};

struct NtagChallengeSent {
  const RequestId request_id = RequestId::kInvalid;
};

struct RequestedSecond {
  const RequestId request_id = RequestId::kInvalid;
};

struct Succeeded {};

struct Rejected {};

struct Failed {
  Ntag424::DNA_StatusCode tag_status;
};

using State = std::variant<Start, NtagChallenge, NtagChallengeSent,
                           RequestedSecond, Succeeded, Rejected, Failed>;

State StateSendChallenge(Ntag424 &ntag_interface, Start start);

}  // namespace authorize

struct Authorize {
  std::array<std::byte, 7> tag_uid;
  std::shared_ptr<authorize::State> state;
};

}  // namespace oww::state::tag