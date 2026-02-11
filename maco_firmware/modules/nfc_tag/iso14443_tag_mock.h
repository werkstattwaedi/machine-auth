// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <algorithm>
#include <optional>
#include <vector>

#include "maco_firmware/modules/nfc_tag/mock_tag.h"
#include "pw_bytes/span.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace maco::nfc {

/// Simple mock tag with preset single-shot responses.
///
/// Replaces the old inline MockTag for simple tests that don't need
/// stateful multi-step protocols.
class Iso14443TagMock : public MockTag {
 public:
  using MockTag::MockTag;  // Inherit constructors

  /// Set the response for the next transceive.
  void SetNextResponse(pw::ConstByteSpan response) {
    next_response_.assign(response.begin(), response.end());
    next_error_.reset();
  }

  /// Set an error for the next transceive.
  void SetNextError(pw::Status status) {
    next_error_ = status;
    next_response_.clear();
  }

  pw::Result<size_t> HandleTransceive(
      pw::ConstByteSpan /*command*/,
      pw::ByteSpan response_buffer) override {
    if (next_error_.has_value()) {
      pw::Status err = *next_error_;
      next_error_.reset();
      return err;
    }
    if (!next_response_.empty()) {
      size_t copy_len =
          std::min(next_response_.size(), response_buffer.size());
      std::copy(next_response_.begin(), next_response_.begin() + copy_len,
                response_buffer.begin());
      next_response_.clear();
      return copy_len;
    }
    return size_t{0};
  }

 private:
  std::vector<std::byte> next_response_;
  std::optional<pw::Status> next_error_;
};

}  // namespace maco::nfc
