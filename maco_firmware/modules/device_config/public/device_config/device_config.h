// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file device_config.h
/// @brief Cloud-configurable device configuration from Particle Ledger.
///
/// DeviceConfig reads the "terminal-config" ledger and provides typed
/// accessors. On cloud update, calls on_update (typically to reboot).

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string_view>

#include "maco_firmware/types.h"
#include "pb_cloud/ledger_backend.h"
#include "pw_containers/vector.h"
#include "pw_function/function.h"
#include "pw_string/string.h"

namespace maco::config {

enum class HwRevision { kUnspecified = 0, kBreadboard = 1, kPrototype = 2 };
enum class MachineControlType { kUnspecified = 0, kRelay = 1 };

/// Read-only machine configuration parsed from proto.
class MachineConfig {
 public:
  MachineConfig() = default;

  MachineConfig(FirebaseId id,
                pw::InlineString<64> label,
                pw::Vector<FirebaseId, 5> required_permissions,
                MachineControlType control)
      : id_(id),
        label_(label),
        required_permissions_(required_permissions),
        control_(control) {}

  const FirebaseId& id() const { return id_; }
  std::string_view label() const { return std::string_view(label_); }
  pw::span<const FirebaseId> required_permissions() const {
    return pw::span<const FirebaseId>(required_permissions_.data(),
                                      required_permissions_.size());
  }
  MachineControlType control() const { return control_; }

 private:
  FirebaseId id_ = FirebaseId::Empty();
  pw::InlineString<64> label_;
  pw::Vector<FirebaseId, 5> required_permissions_;
  MachineControlType control_ = MachineControlType::kUnspecified;
};

/// Cloud-configurable device configuration.
///
/// Reads from the "terminal-config" Particle Ledger at boot via Init().
/// Monitors for cloud updates via Start() and calls on_update (reboot)
/// when the config changes.
class DeviceConfig {
 public:
  DeviceConfig(pb::cloud::LedgerBackend& backend,
               DeviceId device_id,
               pw::Function<void()> on_update);

  /// Read config from ledger. Called once at boot.
  /// Returns defaults if ledger has no data yet.
  pw::Status Init();

  /// Start watching for cloud config updates.
  void Start(pw::async2::Dispatcher& dispatcher);

  const DeviceId& device_id() const { return device_id_; }
  HwRevision hw_revision() const { return hw_revision_; }
  size_t machine_count() const { return machines_.size(); }
  const MachineConfig& machine(size_t index) const { return machines_[index]; }
  std::string_view gateway_host() const {
    return std::string_view(gateway_host_);
  }
  uint32_t gateway_port() const { return gateway_port_; }

 private:
  pb::cloud::LedgerBackend& backend_;
  DeviceId device_id_;
  pw::Function<void()> on_update_;

  HwRevision hw_revision_ = HwRevision::kUnspecified;
  pw::Vector<MachineConfig, 4> machines_;
  pw::InlineString<64> gateway_host_;
  uint32_t gateway_port_ = 0;
  std::optional<pb::cloud::SyncEventReceiver> sync_receiver_;
};

}  // namespace maco::config
