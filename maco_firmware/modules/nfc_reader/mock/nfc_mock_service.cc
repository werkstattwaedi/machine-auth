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

pw::Status NfcMockService::SimulateNtag424Arrival(
    const ::maco_SimulateNtag424ArrivalRequest& request,
    ::maco_SimulateNtag424ArrivalResponse& response) {
  pw::ConstByteSpan uid(reinterpret_cast<const std::byte*>(request.uid.bytes),
                        request.uid.size);

  // NTAG424 DNA always has SAK=0x20 (ISO 14443-4 compliant)
  constexpr uint8_t kNtag424Sak = 0x20;

  // Build config from request
  Ntag424TagMock::Config config{};

  if (request.real_uid.size == 7) {
    std::memcpy(config.real_uid.data(), request.real_uid.bytes, 7);
  }

  auto copy_key = [](const auto& src, std::array<std::byte, 16>& dst) {
    if (src.size == 16) {
      std::memcpy(dst.data(), src.bytes, 16);
    }
  };
  copy_key(request.key0, config.keys[0]);
  copy_key(request.key1, config.keys[1]);
  copy_key(request.key2, config.keys[2]);
  copy_key(request.key3, config.keys[3]);
  copy_key(request.key4, config.keys[4]);

  PW_LOG_INFO("SimulateNtag424Arrival: UID size=%zu", uid.size());

  ntag424_tag_ =
      std::make_shared<Ntag424TagMock>(uid, kNtag424Sak, config, rng_);
  mock_reader_.SimulateTagArrival(
      std::static_pointer_cast<MockTag>(ntag424_tag_));

  // Echo back real UID
  std::memcpy(response.real_uid.bytes, config.real_uid.data(), 7);
  response.real_uid.size = 7;

  return pw::OkStatus();
}

}  // namespace maco::nfc
