// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_pb/maco_service.rpc.pwpb.h"

namespace maco {

// RPC service for device management and diagnostics.
// See protos/maco_service.proto for service details.
class MacoService final
    : public ::maco::pw_rpc::pwpb::MacoService::Service<MacoService> {
 public:
  pw::Status Echo(const ::maco::pwpb::EchoMessage::Message& request,
                  ::maco::pwpb::EchoMessage::Message& response);

  pw::Status GetDeviceInfo(const ::maco::pwpb::Empty::Message& request,
                           ::maco::pwpb::DeviceInfoResponse::Message& response);
};

}  // namespace maco
