// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "async_util/value_or_timeout.h"

#include <optional>

#include "gtest/gtest.h"
#include "pw_allocator/testing.h"
#include "pw_async2/basic_dispatcher.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/simulated_time_provider.h"
#include "pw_async2/value_future.h"
#include "pw_chrono/system_clock.h"
#include "pw_result/result.h"

namespace maco::async_util {
namespace {

using namespace std::chrono_literals;

constexpr auto kDeadline = 10s;

// Free-function coroutine: a capturing-lambda coroutine would dangle because
// the closure is destroyed once the coroutine object is constructed. Params
// are copied/moved into the frame, so they stay valid.
pw::async2::Coro<pw::Status> AwaitRace(
    pw::async2::CoroContext,
    pw::async2::ValueFuture<int> future,
    pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
    std::optional<pw::Result<int>>* out) {
  *out = co_await RaceWithDeadline(std::move(future), time_provider, kDeadline);
  co_return pw::OkStatus();
}

class ValueOrTimeoutTest : public ::testing::Test {
 protected:
  void Run(pw::async2::ValueFuture<int> future,
           std::optional<pw::Result<int>>* out) {
    task_.emplace(AwaitRace(coro_cx_, std::move(future), time_provider_, out),
                  [](pw::Status) {});
    dispatcher_.Post(*task_);
    dispatcher_.RunUntilStalled();
  }

  pw::allocator::test::AllocatorForTest<2048> allocator_;
  pw::async2::SimulatedTimeProvider<pw::chrono::SystemClock> time_provider_;
  pw::async2::BasicDispatcher dispatcher_;
  pw::async2::CoroContext coro_cx_{allocator_};
  std::optional<pw::async2::CoroOrElseTask> task_;
};

TEST_F(ValueOrTimeoutTest, PrimaryResolvesBeforeTimeoutReturnsValue) {
  pw::async2::ValueProvider<int> provider;
  std::optional<pw::Result<int>> result;

  Run(provider.Get(), &result);
  EXPECT_FALSE(result.has_value());  // still waiting on both

  provider.Resolve(42);
  dispatcher_.RunUntilStalled();

  ASSERT_TRUE(result.has_value());
  ASSERT_TRUE(result->ok());
  EXPECT_EQ(**result, 42);
}

TEST_F(ValueOrTimeoutTest, TimeoutFiresBeforePrimaryReturnsDeadlineExceeded) {
  pw::async2::ValueProvider<int> provider;
  std::optional<pw::Result<int>> result;

  Run(provider.Get(), &result);
  EXPECT_FALSE(result.has_value());

  time_provider_.AdvanceUntilNextExpiration();
  dispatcher_.RunUntilStalled();

  ASSERT_TRUE(result.has_value());
  EXPECT_FALSE(result->ok());
  EXPECT_TRUE(result->status().IsDeadlineExceeded());
}

}  // namespace
}  // namespace maco::async_util
