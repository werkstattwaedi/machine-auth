// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "device_config/device_config.h"

#include "device_config/device_config_nanopb_fields.h"
#include "pb_cloud/ledger_typed_api.h"

#define PW_LOG_MODULE_NAME "config"
#include "pw_log/log.h"

namespace maco::config {

namespace {

constexpr const char* kLedgerName = "terminal-config";
constexpr const char* kProtoKey = "device_config.proto.b64";

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
  switch (c.which_control) {
    case maco_proto_particle_MachineControl_relay_tag:
      return MachineControlType::kRelay;
    case maco_proto_particle_MachineControl_xtool_p2s_tag:
      return MachineControlType::kXToolP2s;
    default:
      return MachineControlType::kUnspecified;
  }
}

// Resolve xTool parameters, mapping proto zero-values to their defaults.
XToolConfig ConvertXTool(const maco_proto_particle_XToolP2sControl& x) {
  XToolConfig cfg;
  cfg.host = x.host;
  // Ignore an out-of-range port (keeps the 8080 default) rather than
  // silently truncating a bad value.
  if (x.port != 0 && x.port <= 0xFFFF) {
    cfg.port = static_cast<uint16_t>(x.port);
  }
  if (x.idle_timeout_sec != 0) {
    cfg.idle_timeout_sec = x.idle_timeout_sec;
  }
  if (x.idle_warning_sec != 0) {
    cfg.idle_warning_sec = x.idle_warning_sec;
  }
  if (x.poll_interval_sec != 0) {
    cfg.poll_interval_sec = x.poll_interval_sec;
  }
  return cfg;
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

  XToolConfig xtool;
  if (m.control.which_control ==
      maco_proto_particle_MachineControl_xtool_p2s_tag) {
    xtool = ConvertXTool(m.control.control.xtool_p2s);
  }

  return MachineConfig(id.ok() ? *id : FirebaseId::Empty(), label, permissions,
                       ConvertControl(m.control), xtool);
}

}  // namespace

DeviceConfig::DeviceConfig(pb::cloud::LedgerBackend& backend,
                           DeviceId device_id,
                           pw::Function<void()> on_update)
    : backend_(backend),
      device_id_(device_id),
      on_update_(std::move(on_update)) {}

pw::Status DeviceConfig::Init() {
  auto result =
      pb::cloud::ReadLedgerProtoB64<maco_proto_particle_DeviceConfig>(
          backend_, kLedgerName, kProtoKey);
  if (!result.ok()) {
    if (result.status() == pw::Status::NotFound()) {
      PW_LOG_INFO("No config in ledger, using defaults");
      return pw::OkStatus();
    }
    PW_LOG_WARN("Config read failed: %d",
                static_cast<int>(result.status().code()));
    return result.status();
  }

  const auto& proto = result.value();
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
