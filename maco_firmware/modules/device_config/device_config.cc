// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "device_config/device_config.h"

#include "pb_decode.h"

#include "particle/device_config.pb.h"

#define PW_LOG_MODULE_NAME "config"
#include "pw_log/log.h"

namespace maco::config {

namespace {

constexpr const char* kLedgerName = "terminal-config";

HwRevision ConvertHwRevision(maco_proto_particle_HwRevision proto) {
  switch (proto) {
    case maco_proto_particle_HwRevision_HW_REVISION_BREADBOARD:
      return HwRevision::kBreadboard;
    case maco_proto_particle_HwRevision_HW_REVISION_PROTOTYPE:
      return HwRevision::kPrototype;
    default:
      return HwRevision::kUnspecified;
  }
}

MachineControlType ConvertControl(const maco_proto_particle_MachineControl& c) {
  if (c.which_control == maco_proto_particle_MachineControl_relay_tag) {
    return MachineControlType::kRelay;
  }
  return MachineControlType::kUnspecified;
}

MachineConfig ConvertMachine(const maco_proto_particle_Machine& m) {
  auto id = FirebaseId::FromString(m.id.value);
  pw::InlineString<64> label(m.label);

  pw::Vector<FirebaseId, 5> permissions;
  for (size_t i = 0; i < m.required_permissions_count; ++i) {
    auto perm = FirebaseId::FromString(m.required_permissions[i].value);
    if (perm.ok()) {
      permissions.push_back(*perm);
    }
  }

  return MachineConfig(id.ok() ? *id : FirebaseId::Empty(), label, permissions,
                       ConvertControl(m.control));
}

}  // namespace

DeviceConfig::DeviceConfig(pb::cloud::LedgerBackend& backend,
                           DeviceId device_id,
                           pw::Function<void()> on_update)
    : backend_(backend),
      device_id_(device_id),
      on_update_(std::move(on_update)) {}

pw::Status DeviceConfig::Init() {
  // Get ledger handle
  auto ledger_result = backend_.GetLedger(kLedgerName);
  if (!ledger_result.ok()) {
    PW_LOG_WARN("Failed to open ledger: %d",
                static_cast<int>(ledger_result.status().code()));
    return ledger_result.status();
  }

  // Read raw bytes
  std::array<std::byte, 512> buffer;
  auto read_result = ledger_result.value().Read(buffer);
  if (!read_result.ok()) {
    PW_LOG_WARN("Ledger read failed: %d (using defaults)",
                static_cast<int>(read_result.status().code()));
    return read_result.status();
  }

  size_t data_size = read_result.value();
  if (data_size == 0) {
    PW_LOG_INFO("Ledger empty, using defaults");
    return pw::OkStatus();
  }

  // Decode nanopb
  maco_proto_particle_DeviceConfig proto =
      maco_proto_particle_DeviceConfig_init_zero;
  pb_istream_t stream = pb_istream_from_buffer(
      reinterpret_cast<const pb_byte_t*>(buffer.data()), data_size);
  if (!pb_decode(&stream, maco_proto_particle_DeviceConfig_fields, &proto)) {
    PW_LOG_WARN("Proto decode failed");
    return pw::Status::DataLoss();
  }

  hw_revision_ = ConvertHwRevision(proto.hw_revision);

  machines_.clear();
  for (size_t i = 0; i < proto.machines_count; ++i) {
    machines_.push_back(ConvertMachine(proto.machines[i]));
  }

  if (proto.gateway_host[0] != '\0') {
    gateway_host_ = proto.gateway_host;
  }
  gateway_port_ = proto.gateway_port;

  PW_LOG_INFO("Config loaded: %zu machines, gateway=%s:%u", machines_.size(),
              gateway_host_.empty() ? "(none)" : gateway_host_.c_str(),
              static_cast<unsigned>(gateway_port_));
  return pw::OkStatus();
}

void DeviceConfig::Start(pw::async2::Dispatcher& /*dispatcher*/) {
  // Subscribe to ledger sync events. When cloud updates arrive,
  // re-read config and call on_update (reboot).
  // SubscribeToSync returns a Receiver directly (always succeeds).
  sync_receiver_.emplace(backend_.SubscribeToSync(kLedgerName));

  // Config changes will take effect on next reboot for now.
  // TODO: Add async monitor coroutine to poll receiver and call on_update_.
  PW_LOG_INFO("DeviceConfig started");
}

}  // namespace maco::config
