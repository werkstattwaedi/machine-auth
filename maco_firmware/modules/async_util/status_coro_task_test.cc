// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "async_util/status_coro_task.h"

#include <optional>

#include "pw_allocator/testing.h"
#include "pw_async2/basic_dispatcher.h"
#include "pw_async2/coro.h"
#include "pw_unit_test/framework.h"

namespace maco::async_util {
namespace {

pw::async2::Coro<pw::Status> ReturnStatus(
    pw::async2::CoroContext, pw::Status status
) {
  co_return status;
}

pw::async2::Coro<pw::Status> AwaitNested(pw::async2::CoroContext cx) {
  co_return co_await ReturnStatus(cx, pw::OkStatus());
}

class StatusCoroTaskTest : public ::testing::Test {
 protected:
  void Run(pw::async2::Coro<pw::Status>&& coro) {
    task_.emplace(std::move(coro), [this](pw::Status status) {
      reported_ = status;
    });
    dispatcher_.Post(*task_);
    dispatcher_.RunUntilStalled();
  }

  pw::async2::BasicDispatcher dispatcher_;
  std::optional<StatusCoroTask> task_;
  std::optional<pw::Status> reported_;
};

TEST_F(StatusCoroTaskTest, OkExitIsNotReported) {
  pw::allocator::test::AllocatorForTest<512> allocator;
  pw::async2::CoroContext cx(allocator);

  Run(ReturnStatus(cx, pw::OkStatus()));

  EXPECT_FALSE(task_->IsRegistered());
  EXPECT_FALSE(reported_.has_value());
}

TEST_F(StatusCoroTaskTest, ErrorExitIsReported) {
  pw::allocator::test::AllocatorForTest<512> allocator;
  pw::async2::CoroContext cx(allocator);

  Run(ReturnStatus(cx, pw::Status::Unavailable()));

  ASSERT_TRUE(reported_.has_value());
  EXPECT_EQ(*reported_, pw::Status::Unavailable());
}

TEST_F(StatusCoroTaskTest, InitialAllocationFailureIsReported) {
  pw::allocator::test::AllocatorForTest<512> allocator;
  allocator.Exhaust();
  pw::async2::CoroContext cx(allocator);

  Run(ReturnStatus(cx, pw::OkStatus()));

  ASSERT_TRUE(reported_.has_value());
  EXPECT_EQ(*reported_, pw::Status::ResourceExhausted());
}

TEST_F(StatusCoroTaskTest, NestedAllocationFailureIsReported) {
  pw::allocator::test::AllocatorForTest<512> allocator;
  pw::async2::CoroContext cx(allocator);
  auto coro = AwaitNested(cx);
  // The outer frame is allocated; the nested one is not.
  allocator.Exhaust();

  Run(std::move(coro));

  ASSERT_TRUE(reported_.has_value());
  EXPECT_EQ(*reported_, pw::Status::ResourceExhausted());
}

}  // namespace
}  // namespace maco::async_util
