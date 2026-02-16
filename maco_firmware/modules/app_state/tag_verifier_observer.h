// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/types.h"
#include "pw_bytes/span.h"
#include "pw_string/string.h"

namespace maco::app_state {

/// Observer interface for TagVerifier state transitions.
///
/// Default empty implementations allow each observer to override only
/// the events it cares about. Methods map 1:1 to AppStateId transitions.
class TagVerifierObserver {
 public:
  virtual ~TagVerifierObserver() = default;
  virtual void OnTagDetected(pw::ConstByteSpan /*uid*/) {}
  virtual void OnVerifying() {}
  virtual void OnTagVerified(pw::ConstByteSpan /*ntag_uid*/) {}
  virtual void OnUnknownTag() {}
  virtual void OnAuthorizing() {}
  virtual void OnAuthorized(const maco::TagUid& /*tag_uid*/,
                            const maco::FirebaseId& /*user_id*/,
                            const pw::InlineString<64>& /*user_label*/,
                            const maco::FirebaseId& /*auth_id*/) {}
  virtual void OnUnauthorized() {}
  virtual void OnTagRemoved() {}
};

}  // namespace maco::app_state
