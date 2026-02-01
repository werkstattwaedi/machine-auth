// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/nfc_reader/mock/nfc_mock_service.h"

#include <cstring>

#include "pw_bytes/span.h"
#include "pw_log/log.h"

namespace maco::nfc {

pw::Status NfcMockService::SimulateTagArrival(
    const ::maco_SimulateTagArrivalRequest& request,
    ::maco_SimulateTagArrivalResponse& response) {
  // Convert uid array to byte span
  pw::ConstByteSpan uid(reinterpret_cast<const std::byte*>(request.uid.bytes),
                        request.uid.size);

  uint8_t sak = static_cast<uint8_t>(request.sak);

  PW_LOG_INFO("SimulateTagArrival: UID size=%zu, SAK=0x%02X", uid.size(), sak);

  mock_reader_.SimulateTagArrival(uid, sak);

  // Echo back the UID
  std::memcpy(response.uid.bytes, request.uid.bytes, request.uid.size);
  response.uid.size = request.uid.size;

  return pw::OkStatus();
}

pw::Status NfcMockService::SimulateTagDeparture(
    const ::maco_SimulateTagDepartureRequest& /*request*/,
    ::maco_SimulateTagDepartureResponse& /*response*/) {
  PW_LOG_INFO("SimulateTagDeparture");

  mock_reader_.SimulateTagDeparture();

  return pw::OkStatus();
}

}  // namespace maco::nfc
