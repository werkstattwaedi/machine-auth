// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file device_config_nanopb_fields.h
/// @brief NanopbFields specialization for DeviceConfig.
///
/// Include this header in any translation unit that uses
/// ProtoSerializer<maco_proto_particle_DeviceConfig>.

#include "particle/device_config.pb.h"
#include "pb_cloud/proto_serializer.h"

template <>
struct pb::cloud::NanopbFields<maco_proto_particle_DeviceConfig> {
  static const pb_msgdesc_t* fields() {
    return maco_proto_particle_DeviceConfig_fields;
  }
  static maco_proto_particle_DeviceConfig init_zero() {
    return maco_proto_particle_DeviceConfig_init_zero;
  }
};
