// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "STORE"

#include "session_upload/session_store.h"

#include <cstring>

#include "maco_firmware/system/psram.h"
#include "pb_decode.h"
#include "pb_encode.h"
#include "pw_log/log.h"

namespace maco::session_upload {

namespace {

// Shared scratch space for PendingUsageQueue serialization.
// All callers run on the single-threaded dispatcher, so sharing is safe.
// .psram.bss is NOT zeroed at boot; always re-initialise before use.
PSRAM_BSS maco_session_upload_PendingUsageQueue queue_scratch_;
PSRAM_BSS std::array<std::byte,
                     maco_session_upload_PendingUsageQueue_size + 16>
    queue_buffer_;

/// Encode a PersistedSession to a buffer.
pw::Result<size_t> EncodeSession(
    const maco_session_upload_PersistedSession& session,
    pw::ByteSpan buffer) {
  pb_ostream_t stream = pb_ostream_from_buffer(
      reinterpret_cast<pb_byte_t*>(buffer.data()), buffer.size());
  if (!pb_encode(&stream, maco_session_upload_PersistedSession_fields,
                 &session)) {
    return pw::Status::Internal();
  }
  return stream.bytes_written;
}

/// Decode a PersistedSession from a buffer.
pw::Result<maco_session_upload_PersistedSession> DecodeSession(
    pw::ConstByteSpan data) {
  maco_session_upload_PersistedSession session =
      maco_session_upload_PersistedSession_init_zero;
  pb_istream_t stream = pb_istream_from_buffer(
      reinterpret_cast<const pb_byte_t*>(data.data()), data.size());
  if (!pb_decode(&stream, maco_session_upload_PersistedSession_fields,
                 &session)) {
    return pw::Status::DataLoss();
  }
  return session;
}

/// Encode a PendingUsageQueue to a buffer.
pw::Result<size_t> EncodeQueue(
    const maco_session_upload_PendingUsageQueue& queue,
    pw::ByteSpan buffer) {
  pb_ostream_t stream = pb_ostream_from_buffer(
      reinterpret_cast<pb_byte_t*>(buffer.data()), buffer.size());
  if (!pb_encode(&stream, maco_session_upload_PendingUsageQueue_fields,
                 &queue)) {
    return pw::Status::Internal();
  }
  return stream.bytes_written;
}

/// Decode a PendingUsageQueue in-place (avoids large return-by-value).
pw::Status DecodeQueue(
    pw::ConstByteSpan data, maco_session_upload_PendingUsageQueue& queue) {
  queue = maco_session_upload_PendingUsageQueue_init_zero;
  pb_istream_t stream = pb_istream_from_buffer(
      reinterpret_cast<const pb_byte_t*>(data.data()), data.size());
  if (!pb_decode(&stream, maco_session_upload_PendingUsageQueue_fields,
                 &queue)) {
    return pw::Status::DataLoss();
  }
  return pw::OkStatus();
}

}  // namespace

SessionStore::SessionStore(pw::kvs::KeyValueStore& kvs) : kvs_(kvs) {}

int64_t SessionStore::ToUnixSeconds(
    pw::chrono::SystemClock::time_point tp, int64_t utc_offset) {
  auto boot_seconds = std::chrono::duration_cast<std::chrono::seconds>(
                          tp.time_since_epoch())
                          .count();
  return boot_seconds + utc_offset;
}

// --- Active session ---

pw::Status SessionStore::SaveActiveSession(
    const app_state::SessionInfo& session, int64_t utc_offset) {
  maco_session_upload_PersistedSession persisted =
      maco_session_upload_PersistedSession_init_zero;

  // Copy tag UID
  persisted.has_tag_uid = true;
  auto tag_bytes = session.tag_uid.bytes();
  std::memcpy(persisted.tag_uid.value, tag_bytes.data(), tag_bytes.size());

  // Copy string fields
  persisted.has_user_id = true;
  auto user_id_str = session.user_id.value();
  std::strncpy(persisted.user_id.value, user_id_str.data(),
               sizeof(persisted.user_id.value) - 1);

  std::strncpy(persisted.user_label, session.user_label.c_str(),
               sizeof(persisted.user_label) - 1);

  persisted.has_auth_id = true;
  auto auth_id_str = session.auth_id.value();
  std::strncpy(persisted.auth_id.value, auth_id_str.data(),
               sizeof(persisted.auth_id.value) - 1);

  persisted.started_at = ToUnixSeconds(session.started_at, utc_offset);
  persisted.last_seen = persisted.started_at;

  std::array<std::byte, maco_session_upload_PersistedSession_size + 16> buffer;
  auto encode_result = EncodeSession(persisted, buffer);
  if (!encode_result.ok()) {
    PW_LOG_ERROR("Failed to encode active session");
    return encode_result.status();
  }

  auto status = kvs_.Put(
      kActiveKey,
      pw::span<const std::byte>(buffer.data(), *encode_result));
  if (!status.ok()) {
    PW_LOG_ERROR("Failed to write active session to KVS");
  }
  return status;
}

pw::Status SessionStore::UpdateHeartbeat(int64_t utc_offset) {
  // Read existing session
  std::array<std::byte, maco_session_upload_PersistedSession_size + 16> buffer;
  auto read_result = kvs_.Get(kActiveKey, pw::span(buffer));
  if (!read_result.ok()) {
    return read_result.status();
  }

  auto decode_result =
      DecodeSession(pw::ConstByteSpan(buffer.data(), read_result.size()));
  if (!decode_result.ok()) {
    return decode_result.status();
  }

  // Update last_seen
  auto& session = *decode_result;
  auto now = pw::chrono::SystemClock::now();
  session.last_seen = ToUnixSeconds(now, utc_offset);

  auto encode_result = EncodeSession(session, buffer);
  if (!encode_result.ok()) {
    return encode_result.status();
  }

  return kvs_.Put(
      kActiveKey,
      pw::span<const std::byte>(buffer.data(), *encode_result));
}

pw::Status SessionStore::ClearActiveSession() {
  auto status = kvs_.Delete(kActiveKey);
  if (status.IsNotFound()) {
    return pw::OkStatus();  // Already cleared
  }
  return status;
}

bool SessionStore::HasOrphanedSession() const {
  return kvs_.ValueSize(kActiveKey).ok();
}

pw::Result<app_state::SessionInfo> SessionStore::LoadOrphanedSession() const {
  std::array<std::byte, maco_session_upload_PersistedSession_size + 16> buffer;
  auto read_result = kvs_.Get(kActiveKey, pw::span(buffer));
  if (!read_result.ok()) {
    return read_result.status();
  }

  auto decode_result =
      DecodeSession(pw::ConstByteSpan(buffer.data(), read_result.size()));
  if (!decode_result.ok()) {
    return decode_result.status();
  }

  const auto& persisted = *decode_result;
  app_state::SessionInfo info;

  // Reconstruct TagUid from stored bytes
  std::array<std::byte, TagUid::kSize> tag_bytes;
  std::memcpy(tag_bytes.data(), persisted.tag_uid.value, TagUid::kSize);
  info.tag_uid = TagUid::FromArray(tag_bytes);

  auto user_id = FirebaseId::FromString(persisted.user_id.value);
  if (!user_id.ok()) {
    return pw::Status::DataLoss();
  }
  info.user_id = *user_id;
  info.user_label = pw::InlineString<64>(persisted.user_label);

  auto auth_id = FirebaseId::FromString(persisted.auth_id.value);
  if (!auth_id.ok()) {
    return pw::Status::DataLoss();
  }
  info.auth_id = *auth_id;

  // Store the original unix timestamp as a duration from epoch.
  // The caller will need to handle the time conversion if needed.
  info.started_at = pw::chrono::SystemClock::time_point(
      std::chrono::seconds(persisted.started_at));

  return info;
}

pw::Result<int64_t> SessionStore::LoadOrphanedLastSeenUnix() const {
  std::array<std::byte, maco_session_upload_PersistedSession_size + 16> buffer;
  auto read_result = kvs_.Get(kActiveKey, pw::span(buffer));
  if (!read_result.ok()) {
    return read_result.status();
  }

  auto decode_result =
      DecodeSession(pw::ConstByteSpan(buffer.data(), read_result.size()));
  if (!decode_result.ok()) {
    return decode_result.status();
  }

  return decode_result->last_seen;
}

// --- Completed usage queue ---

pw::Status SessionStore::StoreCompletedUsage(
    const app_state::MachineUsage& usage, int64_t utc_offset) {
  // Load existing queue (or start empty).
  // Uses file-scope scratch to stay off the 2 KB work-queue stack.
  auto& queue = queue_scratch_;
  queue = maco_session_upload_PendingUsageQueue_init_zero;
  auto read_result = kvs_.Get(kPendingKey, pw::span(queue_buffer_));
  if (read_result.ok()) {
    // Decode failure means corrupt KVS data; proceed with empty queue
    // to self-heal on next write-back.
    (void)DecodeQueue(
        pw::ConstByteSpan(queue_buffer_.data(), read_result.size()), queue);
  }

  if (queue.records_count >= kMaxPendingRecords) {
    PW_LOG_WARN("Pending usage queue full (%zu records), dropping oldest",
                static_cast<size_t>(queue.records_count));
    // Shift records left to make room
    for (pb_size_t i = 1; i < queue.records_count; i++) {
      queue.records[i - 1] = queue.records[i];
    }
    queue.records_count--;
  }

  // Append new record
  auto& record = queue.records[queue.records_count];
  record = maco_session_upload_PersistedUsage_init_zero;

  record.has_user_id = true;
  auto user_id_str = usage.user_id.value();
  std::strncpy(record.user_id.value, user_id_str.data(),
               sizeof(record.user_id.value) - 1);

  record.has_auth_id = true;
  auto auth_id_str = usage.auth_id.value();
  std::strncpy(record.auth_id.value, auth_id_str.data(),
               sizeof(record.auth_id.value) - 1);

  record.check_in = ToUnixSeconds(usage.check_in, utc_offset);
  record.check_out = ToUnixSeconds(usage.check_out, utc_offset);
  record.reason = static_cast<int32_t>(usage.reason);

  queue.records_count++;

  // Write back
  auto encode_result = EncodeQueue(queue, queue_buffer_);
  if (!encode_result.ok()) {
    PW_LOG_ERROR("Failed to encode pending usage queue");
    return encode_result.status();
  }

  auto status = kvs_.Put(
      kPendingKey,
      pw::span<const std::byte>(queue_buffer_.data(), *encode_result));
  if (!status.ok()) {
    PW_LOG_ERROR("Failed to write pending usage to KVS");
  } else {
    PW_LOG_INFO("Usage record queued (%zu pending)",
                static_cast<size_t>(queue.records_count));
  }
  return status;
}

size_t SessionStore::PendingUsageCount() {
  auto read_result = kvs_.Get(kPendingKey, pw::span(queue_buffer_));
  if (!read_result.ok()) {
    return 0;
  }

  if (!DecodeQueue(
          pw::ConstByteSpan(queue_buffer_.data(), read_result.size()),
          queue_scratch_).ok()) {
    return 0;
  }

  return queue_scratch_.records_count;
}

pw::Result<maco_session_upload_PendingUsageQueue>
SessionStore::LoadPendingUsage() {
  auto read_result = kvs_.Get(kPendingKey, pw::span(queue_buffer_));
  if (!read_result.ok()) {
    return read_result.status();
  }

  auto status = DecodeQueue(
      pw::ConstByteSpan(queue_buffer_.data(), read_result.size()),
      queue_scratch_);
  if (!status.ok()) {
    return status;
  }
  return queue_scratch_;
}

pw::Status SessionStore::ClearPendingUsage() {
  auto status = kvs_.Delete(kPendingKey);
  if (status.IsNotFound()) {
    return pw::OkStatus();
  }
  return status;
}

}  // namespace maco::session_upload
