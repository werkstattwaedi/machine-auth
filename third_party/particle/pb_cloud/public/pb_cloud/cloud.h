// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file cloud.h
/// @brief Convenience header that includes all pb_cloud headers.
///
/// Usage:
/// @code
/// #include "pb_cloud/cloud.h"
///
/// // Now you have access to:
/// // - pb::cloud::CloudBackend (interface)
/// // - pb::cloud::PublishTyped<T>(cloud, ...)
/// // - pb::cloud::PublishProto<Proto>(cloud, ...)
/// // - pb::cloud::Serializer<T>, pb::cloud::ProtoSerializer<Proto>
/// // - etc.
///
/// // For production (P2), also include:
/// // #include "pb_cloud/particle_cloud_backend.h"
/// // auto& cloud = pb::cloud::ParticleCloudBackend::Instance();
/// @endcode

#include "pb_cloud/cloud_backend.h"
#include "pb_cloud/proto_serializer.h"
#include "pb_cloud/serializer.h"
#include "pb_cloud/typed_api.h"
#include "pb_cloud/types.h"
