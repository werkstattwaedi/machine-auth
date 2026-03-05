// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "UPLOAD"

#include "session_upload/usage_uploader.h"

#include <cstring>

#include "common.pb.h"
#include "firebase_rpc/usage.pb.h"
#include "maco_firmware/system/psram.h"
#include "pb_encode.h"
#include "pw_log/log.h"

namespace maco::session_upload {

namespace {

/// Map internal CheckoutReason to nanopb CheckOutReason oneof.
void SetCheckoutReason(maco_proto_firebase_rpc_CheckOutReason& out,
                       app_state::CheckoutReason reason) {
  out = maco_proto_firebase_rpc_CheckOutReason_init_zero;
  switch (reason) {
    case app_state::CheckoutReason::kSelfCheckout:
      out.which_reason =
          maco_proto_firebase_rpc_CheckOutReason_self_checkout_tag;
      break;
    case app_state::CheckoutReason::kOtherTag:
      out.which_reason =
          maco_proto_firebase_rpc_CheckOutReason_other_tag_tag;
      break;
    case app_state::CheckoutReason::kUiCheckout:
      out.which_reason = maco_proto_firebase_rpc_CheckOutReason_ui_tag;
      break;
    case app_state::CheckoutReason::kTimeout:
      out.which_reason = maco_proto_firebase_rpc_CheckOutReason_timeout_tag;
      break;
    case app_state::CheckoutReason::kDeviceReset:
      out.which_reason =
          maco_proto_firebase_rpc_CheckOutReason_device_reset_tag;
      break;
    default:
      out.which_reason = maco_proto_firebase_rpc_CheckOutReason_ui_tag;
      break;
  }
}

/// Encode an UploadUsageRequest from pending records + machine ID.
pw::Result<size_t> EncodeUploadRequest(
    const maco_session_upload_PendingUsageQueue& queue,
    const FirebaseId& machine_id,
    pw::ByteSpan buffer) {
  // UploadUsageRequest contains repeated MachineUsage — keep off stack.
  // .psram.bss is NOT zeroed at boot; always re-initialise before use.
  static PSRAM_BSS maco_proto_firebase_rpc_UploadUsageRequest request;
  request = maco_proto_firebase_rpc_UploadUsageRequest_init_zero;

  request.has_history = true;

  // Set machine ID
  request.history.has_machine_id = true;
  auto machine_id_str = machine_id.value();
  std::strncpy(request.history.machine_id.value, machine_id_str.data(),
               sizeof(request.history.machine_id.value) - 1);

  // Map persisted records to wire-format records
  request.history.records_count = queue.records_count;
  for (pb_size_t i = 0; i < queue.records_count; i++) {
    const auto& src = queue.records[i];
    auto& dst = request.history.records[i];
    dst = maco_proto_firebase_rpc_MachineUsage_init_zero;

    dst.has_user_id = true;
    std::strncpy(dst.user_id.value, src.user_id.value,
                 sizeof(dst.user_id.value) - 1);

    dst.has_authentication_id = true;
    std::strncpy(dst.authentication_id.value, src.auth_id.value,
                 sizeof(dst.authentication_id.value) - 1);

    dst.check_in = src.check_in;
    dst.check_out = src.check_out;

    dst.has_reason = true;
    SetCheckoutReason(dst.reason,
                      static_cast<app_state::CheckoutReason>(src.reason));
  }

  pb_ostream_t stream = pb_ostream_from_buffer(
      reinterpret_cast<pb_byte_t*>(buffer.data()), buffer.size());
  if (!pb_encode(&stream,
                 maco_proto_firebase_rpc_UploadUsageRequest_fields,
                 &request)) {
    return pw::Status::Internal();
  }
  return stream.bytes_written;
}

}  // namespace

UsageUploader::UsageUploader(
    SessionStore& store,
    firebase::FirebaseClient& firebase,
    app_state::SystemState& system_state,
    const config::DeviceConfig& config,
    pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
    pw::allocator::Allocator& allocator)
    : store_(store),
      firebase_(firebase),
      system_state_(system_state),
      config_(config),
      time_provider_(time_provider),
      coro_cx_(allocator) {}

void UsageUploader::Start(pw::async2::Dispatcher& dispatcher) {
  auto coro = Run(coro_cx_);
  task_.emplace(std::move(coro), [](pw::Status s) {
    PW_LOG_ERROR("UsageUploader failed: %d", static_cast<int>(s.code()));
  });
  dispatcher.Post(*task_);
}

void UsageUploader::OnSessionStarted(const app_state::SessionInfo& session) {
  session_active_ = true;
  auto utc_offset = system_state_.GetUtcBootOffsetSeconds();
  auto status = store_.SaveActiveSession(session, utc_offset);
  if (!status.ok()) {
    PW_LOG_ERROR("Failed to persist session start");
  }
  last_heartbeat_ = pw::chrono::SystemClock::now();
}

void UsageUploader::OnSessionEnded(const app_state::SessionInfo&,
                                   const app_state::MachineUsage& usage) {
  session_active_ = false;

  // Clear the write-ahead active session
  auto clear_status = store_.ClearActiveSession();
  if (!clear_status.ok()) {
    PW_LOG_ERROR("Failed to clear active session");
  }

  // Queue the completed usage for upload
  auto utc_offset = system_state_.GetUtcBootOffsetSeconds();
  auto store_status = store_.StoreCompletedUsage(usage, utc_offset);
  if (!store_status.ok()) {
    PW_LOG_ERROR("Failed to store completed usage");
  }

  upload_triggered_ = true;
}

pw::async2::Coro<pw::Status> UsageUploader::Run(
    pw::async2::CoroContext& cx) {
  while (true) {
    co_await time_provider_.WaitFor(kPollInterval);

    // Heartbeat: update last_seen timestamp while session is active
    if (session_active_) {
      auto now = pw::chrono::SystemClock::now();
      if (now - last_heartbeat_ >= kHeartbeatInterval) {
        auto utc_offset = system_state_.GetUtcBootOffsetSeconds();
        auto status = store_.UpdateHeartbeat(utc_offset);
        if (status.ok()) {
          last_heartbeat_ = now;
        }
      }
    }

    // Upload: either triggered by session end or periodic retry
    bool should_upload = upload_triggered_;
    if (!should_upload && store_.PendingUsageCount() > 0) {
      auto now = pw::chrono::SystemClock::now();
      if (now - last_upload_attempt_ >= kRetryInterval) {
        // Check gateway connectivity before retry
        app_state::SystemStateSnapshot snapshot;
        system_state_.GetSnapshot(snapshot);
        if (snapshot.gateway_connected) {
          should_upload = true;
        }
      }
    }

    if (should_upload) {
      upload_triggered_ = false;
      last_upload_attempt_ = pw::chrono::SystemClock::now();
      auto status = co_await TryUpload(cx);
      if (!status.ok()) {
        PW_LOG_WARN("Upload failed, will retry");
      }
    }
  }
}

pw::async2::Coro<pw::Status> UsageUploader::TryUpload(
    pw::async2::CoroContext& cx) {
  auto queue_result = store_.LoadPendingUsage();
  if (!queue_result.ok()) {
    PW_LOG_ERROR("Failed to load pending usage");
    co_return queue_result.status();
  }

  if (queue_result->records_count == 0) {
    co_return pw::OkStatus();
  }

  // Get machine ID from config (first machine)
  if (config_.machine_count() == 0) {
    PW_LOG_ERROR("No machine configured, cannot upload usage");
    co_return pw::Status::FailedPrecondition();
  }
  const auto& machine_id = config_.machine(0).id();

  // Encode UploadUsageRequest (static buffer — only one TryUpload runs
  // at a time on the single-threaded dispatcher).
  static PSRAM_BSS std::array<std::byte,
                              maco_proto_firebase_rpc_UploadUsageRequest_size + 16>
      buffer;
  auto encode_result = EncodeUploadRequest(*queue_result, machine_id, buffer);
  if (!encode_result.ok()) {
    PW_LOG_ERROR("Failed to encode upload request");
    co_return encode_result.status();
  }

  PW_LOG_INFO("Uploading %zu usage records",
              static_cast<size_t>(queue_result->records_count));

  auto upload_status = co_await firebase_.UploadUsage(
      cx, pw::ConstByteSpan(buffer.data(), *encode_result));
  if (!upload_status.ok()) {
    co_return upload_status;
  }

  // Upload succeeded — clear the pending queue
  auto clear_status = store_.ClearPendingUsage();
  if (!clear_status.ok()) {
    PW_LOG_ERROR("Failed to clear pending usage after successful upload");
  }

  PW_LOG_INFO("Usage upload complete");
  co_return pw::OkStatus();
}

}  // namespace maco::session_upload
