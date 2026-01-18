// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/nfc_reader/mock/nfc_mock_service.h"

#include "pw_bytes/span.h"
#include "pw_log/log.h"

namespace maco::nfc {

pw::Status NfcMockService::SimulateTagArrival(
    const ::maco::pwpb::SimulateTagArrivalRequest::Message& request,
    ::maco::pwpb::SimulateTagArrivalResponse::Message& response) {
  // Convert uid vector to byte span
  pw::ConstByteSpan uid(
      reinterpret_cast<const std::byte*>(request.uid.data()),
      request.uid.size());

  uint8_t sak = static_cast<uint8_t>(request.sak);

  PW_LOG_INFO("SimulateTagArrival: UID size=%zu, SAK=0x%02X",
              uid.size(), sak);

  mock_reader_.SimulateTagArrival(uid, sak);

  // Echo back the UID
  response.uid.assign(request.uid.begin(), request.uid.end());

  return pw::OkStatus();
}

pw::Status NfcMockService::SimulateTagDeparture(
    const ::maco::pwpb::SimulateTagDepartureRequest::Message& /*request*/,
    ::maco::pwpb::SimulateTagDepartureResponse::Message& /*response*/) {
  PW_LOG_INFO("SimulateTagDeparture");

  mock_reader_.SimulateTagDeparture();

  return pw::OkStatus();
}

}  // namespace maco::nfc
