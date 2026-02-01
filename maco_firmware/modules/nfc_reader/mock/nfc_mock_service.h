// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/nfc_reader/mock/mock_nfc_reader.h"
#include "maco_pb/nfc_mock_service.rpc.pb.h"

namespace maco::nfc {

// RPC service for simulating NFC tag events.
// Used by pw_console to inject tag arrival/departure for testing.
class NfcMockService final
    : public ::maco::pw_rpc::nanopb::NfcMockService::Service<NfcMockService> {
 public:
  explicit NfcMockService(MockNfcReader& mock_reader)
      : mock_reader_(mock_reader) {}

  pw::Status SimulateTagArrival(
      const ::maco_SimulateTagArrivalRequest& request,
      ::maco_SimulateTagArrivalResponse& response);

  pw::Status SimulateTagDeparture(
      const ::maco_SimulateTagDepartureRequest& request,
      ::maco_SimulateTagDepartureResponse& response);

 private:
  MockNfcReader& mock_reader_;
};

}  // namespace maco::nfc
