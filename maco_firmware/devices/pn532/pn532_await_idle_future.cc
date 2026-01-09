// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/devices/pn532/pn532_await_idle_future.h"

#include "maco_firmware/devices/pn532/pn532_nfc_reader.h"

namespace maco::nfc {

pw::async2::Poll<> Pn532AwaitIdleFuture::Pend(
    [[maybe_unused]] pw::async2::Context& cx) {
  if (reader_ == nullptr) {
    return pw::async2::Ready();
  }

  if (!reader_->IsBusy()) {
    return pw::async2::Ready();
  }

  return pw::async2::Pending();
}

}  // namespace maco::nfc
