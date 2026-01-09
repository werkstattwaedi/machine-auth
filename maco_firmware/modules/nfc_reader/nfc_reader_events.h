// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <memory>

#include "etl/message.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader_driver.h"
#include "pw_result/result.h"

namespace maco::nfc {

// Forward declarations
class NfcTag;
struct TransceiveRequest;

/// Message IDs for NfcReader FSM events.
enum class NfcReaderMessageId : etl::message_id_t {
  kStart = 0,
  kTagDetected,
  kTagNotFound,
  kProbeComplete,
  kProbeFailed,
  kEventSent,
  kPresenceCheckDue,
  kTagPresent,
  kTagGone,
  kAppRequest,
  kOpComplete,
  kOpFailed,
};

/// Start tag detection (from idle state).
struct MsgStart
    : public etl::message<
          static_cast<etl::message_id_t>(NfcReaderMessageId::kStart)> {};

/// Tag was detected by InListPassiveTarget.
struct MsgTagDetected
    : public etl::message<
          static_cast<etl::message_id_t>(NfcReaderMessageId::kTagDetected)> {
  explicit MsgTagDetected(const TagInfo& info) : info(info) {}
  TagInfo info;
};

/// No tag found (detection timeout).
struct MsgTagNotFound
    : public etl::message<
          static_cast<etl::message_id_t>(NfcReaderMessageId::kTagNotFound)> {};

/// Tag type probing completed successfully.
struct MsgProbeComplete
    : public etl::message<
          static_cast<etl::message_id_t>(NfcReaderMessageId::kProbeComplete)> {
  explicit MsgProbeComplete(std::shared_ptr<NfcTag> tag)
      : tag(std::move(tag)) {}
  std::shared_ptr<NfcTag> tag;
};

/// Tag type probing failed.
struct MsgProbeFailed
    : public etl::message<
          static_cast<etl::message_id_t>(NfcReaderMessageId::kProbeFailed)> {};

/// Channel send completed (event delivered to application).
struct MsgEventSent
    : public etl::message<
          static_cast<etl::message_id_t>(NfcReaderMessageId::kEventSent)> {};

/// Presence check timer elapsed.
struct MsgPresenceCheckDue : public etl::message<static_cast<etl::message_id_t>(
                                 NfcReaderMessageId::kPresenceCheckDue
                             )> {};

/// Presence check confirmed tag is still present.
struct MsgTagPresent
    : public etl::message<
          static_cast<etl::message_id_t>(NfcReaderMessageId::kTagPresent)> {};

/// Presence check found tag is gone.
struct MsgTagGone
    : public etl::message<
          static_cast<etl::message_id_t>(NfcReaderMessageId::kTagGone)> {};

/// Application requested a transceive operation.
struct MsgAppRequest
    : public etl::message<
          static_cast<etl::message_id_t>(NfcReaderMessageId::kAppRequest)> {
  explicit MsgAppRequest(TransceiveRequest* request) : request(request) {}
  TransceiveRequest* request;
};

/// Application operation completed successfully.
struct MsgOpComplete
    : public etl::message<
          static_cast<etl::message_id_t>(NfcReaderMessageId::kOpComplete)> {
  explicit MsgOpComplete(pw::Result<size_t> result)
      : result(std::move(result)) {}
  pw::Result<size_t> result;
};

/// Application operation failed (tag may be gone).
struct MsgOpFailed
    : public etl::message<
          static_cast<etl::message_id_t>(NfcReaderMessageId::kOpFailed)> {};

}  // namespace maco::nfc
