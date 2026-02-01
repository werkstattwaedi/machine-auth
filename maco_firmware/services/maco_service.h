// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_pb/maco_service.rpc.pb.h"

namespace maco {

// RPC service for device management and diagnostics.
// See protos/maco_service.proto for service details.
class MacoService final
    : public ::maco::pw_rpc::nanopb::MacoService::Service<MacoService> {
 public:
  pw::Status Echo(const ::maco_EchoMessage& request,
                  ::maco_EchoMessage& response);

  pw::Status GetDeviceInfo(const ::maco_Empty& request,
                           ::maco_DeviceInfoResponse& response);
};

}  // namespace maco
