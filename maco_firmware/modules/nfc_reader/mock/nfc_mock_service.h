// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <memory>

#include "maco_firmware/modules/nfc_reader/mock/mock_nfc_reader.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag_mock.h"
#include "maco_pb/nfc_mock_service.rpc.pb.h"
#include "pw_random/random.h"

namespace maco::nfc {

// RPC service for simulating NFC tag events.
// Used by pw_console to inject tag arrival/departure for testing.
class NfcMockService final
    : public ::maco::pw_rpc::nanopb::NfcMockService::Service<NfcMockService> {
 public:
  NfcMockService(MockNfcReader& mock_reader,
                 pw::random::RandomGenerator& rng)
      : mock_reader_(mock_reader), rng_(rng) {}

  pw::Status SimulateTagArrival(
      const ::maco_SimulateTagArrivalRequest& request,
      ::maco_SimulateTagArrivalResponse& response);

  pw::Status SimulateTagDeparture(
      const ::maco_SimulateTagDepartureRequest& request,
      ::maco_SimulateTagDepartureResponse& response);

  pw::Status SimulateNtag424Arrival(
      const ::maco_SimulateNtag424ArrivalRequest& request,
      ::maco_SimulateNtag424ArrivalResponse& response);

 private:
  MockNfcReader& mock_reader_;
  pw::random::RandomGenerator& rng_;
  std::shared_ptr<Ntag424TagMock> ntag424_tag_;
};

}  // namespace maco::nfc
