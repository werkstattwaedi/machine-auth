// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "etl/message.h"
#include "maco_firmware/types.h"
#include "pw_string/string.h"

namespace maco::app_state::session_event {

struct Id {
  enum enum_type : etl::message_id_t {
    kUserAuthorized = 0,
    kTagPresence = 1,
    kUiConfirm = 2,
    kUiCancel = 3,
    kHoldConfirmed = 4,
    kTimeout = 5,
  };
};

/// A user's tag was verified and cloud-authorized.
class UserAuthorized : public etl::message<Id::kUserAuthorized> {
 public:
  UserAuthorized(maco::TagUid tag_uid_in,
                 maco::FirebaseId user_id_in,
                 const pw::InlineString<64>& user_label_in,
                 maco::FirebaseId auth_id_in)
      : tag_uid(tag_uid_in),
        user_id(user_id_in),
        user_label(user_label_in),
        auth_id(auth_id_in) {}

  maco::TagUid tag_uid;
  maco::FirebaseId user_id;
  pw::InlineString<64> user_label;
  maco::FirebaseId auth_id;
};

/// Tag physical presence changed on the reader.
class TagPresence : public etl::message<Id::kTagPresence> {
 public:
  explicit TagPresence(bool is_present) : present(is_present) {}
  bool present;
};

/// UI confirmed the pending action (checkout or takeover).
class UiConfirm : public etl::message<Id::kUiConfirm> {};

/// UI cancelled the pending action.
class UiCancel : public etl::message<Id::kUiCancel> {};

/// Tag was held long enough during a pending confirmation.
class HoldConfirmed : public etl::message<Id::kHoldConfirmed> {};

/// Pending confirmation timed out.
class Timeout : public etl::message<Id::kTimeout> {};

}  // namespace maco::app_state::session_event
