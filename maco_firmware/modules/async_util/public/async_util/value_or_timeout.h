// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <type_traits>
#include <utility>

#include "pw_async2/context.h"
#include "pw_async2/future.h"
#include "pw_async2/poll.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace maco::async_util {

/// A future that resolves to `pw::Result<T>` by racing a primary value future
/// against a timeout future. The primary is checked first: if it resolves, its
/// value is returned wrapped in an ok `Result`; otherwise, if the timeout
/// future fires, the `Result` is `DeadlineExceeded`.
///
/// Satisfies the `pw::async2::Future` concept (default-constructible, movable,
/// with `is_pendable()`/`is_complete()`), so it can be `co_await`ed directly
/// from a `pw::async2::Coro`.
///
/// Why this exists instead of pw_async2's `future_timeout.h`: that header
/// cannot be compiled by the arm-none-eabi GCC toolchain — an unused
/// `TimeoutOr(ValueFuture<void>, ...)` overload contains a `static_assert(false)`
/// that this GCC evaluates at parse time, so merely including the header fails
/// the build. This combinator implements the same primary-checked-first race
/// without pulling in that header.
template <typename PrimaryFuture, typename TimeoutFuture>
class [[nodiscard]] ValueOrTimeout {
 public:
  using Inner = typename PrimaryFuture::value_type;
  using value_type = pw::Result<Inner>;

  constexpr ValueOrTimeout() = default;

  ValueOrTimeout(PrimaryFuture&& primary, TimeoutFuture&& timeout)
      : primary_(std::move(primary)),
        timeout_(std::move(timeout)),
        state_(pw::async2::FutureState::kPending) {}

  [[nodiscard]] constexpr bool is_pendable() const {
    return state_.is_pendable();
  }
  [[nodiscard]] constexpr bool is_complete() const {
    return state_.is_complete();
  }

  pw::async2::Poll<value_type> Pend(pw::async2::Context& cx) {
    auto primary = primary_.Pend(cx);
    if (primary.IsReady()) {
      state_.MarkComplete();
      return pw::async2::Ready(value_type(std::move(*primary)));
    }
    if (timeout_.Pend(cx).IsReady()) {
      state_.MarkComplete();
      return pw::async2::Ready(value_type(pw::Status::DeadlineExceeded()));
    }
    return pw::async2::Pending();
  }

 private:
  PrimaryFuture primary_;
  TimeoutFuture timeout_;
  pw::async2::FutureState state_;
};

/// Races `primary` against a timer from `time_provider` expiring after `delay`.
/// Resolves to `pw::Result<primary's value_type>`: the value on success, or
/// `DeadlineExceeded` if the timer wins. Awaitable directly from a coroutine.
template <typename PrimaryFuture, typename TimeProvider, typename Duration>
auto RaceWithDeadline(PrimaryFuture&& primary,
                      TimeProvider& time_provider,
                      Duration delay) {
  auto timer = time_provider.WaitFor(delay);
  return ValueOrTimeout<std::decay_t<PrimaryFuture>, decltype(timer)>(
      std::forward<PrimaryFuture>(primary), std::move(timer));
}

}  // namespace maco::async_util
