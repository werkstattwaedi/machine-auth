// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <utility>

#include "pw_async2/context.h"
#include "pw_async2/coro.h"
#include "pw_async2/poll.h"
#include "pw_async2/task.h"
#include "pw_function/function.h"
#include "pw_status/status.h"

namespace maco::async_util {

/// Runs a `Coro<pw::Status>` as a dispatcher task and reports a non-OK exit
/// to `on_error`.
///
/// Stand-in for Pigweed's removed `CoroOrElseTask`: its successors
/// (`FallibleCoroTask`, `FutureTask`) only handle allocation failure and
/// discard the coroutine's own status, but our long-running loops rely on
/// having their failure logged. A failed coroutine-frame allocation (including
/// a nested `co_await`ed coroutine) is reported as `ResourceExhausted` instead
/// of crashing.
class StatusCoroTask final : public pw::async2::Task {
 public:
  using ErrorHandler = pw::Function<void(pw::Status)>;

  StatusCoroTask(pw::async2::Coro<pw::Status>&& coro, ErrorHandler&& on_error)
      : future_(std::move(coro), &AllocationFailed),
        on_error_(std::move(on_error)) {}

  ~StatusCoroTask() override { Deregister(); }

 private:
  static pw::Status AllocationFailed() {
    return pw::Status::ResourceExhausted();
  }

  pw::async2::Poll<> DoPend(pw::async2::Context& cx) override {
    if (!future_.is_pendable()) {
      return pw::async2::Ready();
    }
    pw::async2::Poll<pw::Status> result = future_.Pend(cx);
    if (result.IsPending()) {
      return pw::async2::Pending();
    }
    if (!result->ok()) {
      on_error_(*result);
    }
    return pw::async2::Ready();
  }

  pw::async2::FallibleCoro<pw::Status, pw::Status (*)()> future_;
  ErrorHandler on_error_;
};

}  // namespace maco::async_util
