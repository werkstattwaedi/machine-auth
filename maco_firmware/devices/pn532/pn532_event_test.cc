// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Unit tests for PN532 NFC reader event subscription mechanism.

#include "pw_async2/dispatcher_for_test.h"
#include "pw_async2/pend_func_task.h"
#include "pw_async2/value_future.h"
#include "pw_unit_test/framework.h"

#include "maco_firmware/modules/nfc_reader/nfc_event.h"

namespace maco::nfc {
namespace {

using pw::async2::Context;
using pw::async2::DispatcherForTest;
using pw::async2::Pending;
using pw::async2::Poll;
using pw::async2::Ready;
using pw::async2::ValueFuture;
using pw::async2::ValueProvider;

// ============================================================================
// Basic ValueProvider Tests (sanity check)
// ============================================================================

TEST(ValueProviderTest, ResolveBeforePoll_FutureSeesValue) {
  DispatcherForTest dispatcher;
  ValueProvider<int> provider;

  auto future = provider.Get();
  provider.Resolve(42);

  auto poll = dispatcher.RunInTaskUntilStalled(future);
  ASSERT_TRUE(poll.IsReady());
  EXPECT_EQ(*poll, 42);
}

TEST(ValueProviderTest, ResolveAfterPoll_FutureSeesValue) {
  DispatcherForTest dispatcher;
  ValueProvider<int> provider;

  auto future = provider.Get();

  // First poll - pending
  auto poll1 = dispatcher.RunInTaskUntilStalled(future);
  ASSERT_TRUE(poll1.IsPending());

  // Resolve
  provider.Resolve(42);

  // Second poll - ready
  auto poll2 = dispatcher.RunInTaskUntilStalled(future);
  ASSERT_TRUE(poll2.IsReady());
  EXPECT_EQ(*poll2, 42);
}

// ============================================================================
// NfcEvent ValueProvider Tests
// ============================================================================

TEST(NfcEventProviderTest, ResolveTagArrived_FutureSeesEvent) {
  DispatcherForTest dispatcher;
  ValueProvider<NfcEvent> provider;

  auto future = provider.Get();

  // Create a mock tag event
  NfcEvent event{NfcEventType::kTagArrived, nullptr};
  provider.Resolve(std::move(event));

  auto poll = dispatcher.RunInTaskUntilStalled(future);
  ASSERT_TRUE(poll.IsReady());
  EXPECT_EQ(poll->type, NfcEventType::kTagArrived);
}

TEST(NfcEventProviderTest, ResolveFromTask_FutureSeesEvent) {
  DispatcherForTest dispatcher;
  ValueProvider<NfcEvent> provider;

  auto future = provider.Get();

  // Create a task that will resolve the provider
  bool resolved = false;
  pw::async2::PendFuncTask resolver_task([&](Context&) -> Poll<> {
    NfcEvent event{NfcEventType::kTagArrived, nullptr};
    provider.Resolve(std::move(event));
    resolved = true;
    return Ready();
  });

  // Post the resolver task
  dispatcher.Post(resolver_task);

  // First poll of future - might be pending
  auto poll1 = dispatcher.RunInTaskUntilStalled(future);

  // If still pending, run until stalled to let resolver run
  if (poll1.IsPending()) {
    dispatcher.RunUntilStalled();
    // Poll again
    auto poll2 = dispatcher.RunInTaskUntilStalled(future);
    ASSERT_TRUE(poll2.IsReady()) << "Future should be ready after resolver ran";
    EXPECT_EQ(poll2->type, NfcEventType::kTagArrived);
  } else {
    EXPECT_EQ(poll1->type, NfcEventType::kTagArrived);
  }

  EXPECT_TRUE(resolved);
}

TEST(NfcEventProviderTest, PersistentTaskPattern_ReceivesEvent) {
  DispatcherForTest dispatcher;
  ValueProvider<NfcEvent> provider;

  std::optional<ValueFuture<NfcEvent>> future;
  future.emplace(provider.Get());

  std::optional<NfcEvent> received_event;

  // Create a persistent task that waits for the event
  pw::async2::PendFuncTask waiter_task([&](Context& cx) -> Poll<> {
    auto poll = future->Pend(cx);
    if (poll.IsPending()) {
      return Pending();
    }
    received_event = std::move(*poll);
    return Ready();
  });

  // Create a resolver task
  pw::async2::PendFuncTask resolver_task([&](Context&) -> Poll<> {
    NfcEvent event{NfcEventType::kTagArrived, nullptr};
    provider.Resolve(std::move(event));
    return Ready();
  });

  // Post waiter first
  dispatcher.Post(waiter_task);

  // Run until stalled - waiter should be pending
  dispatcher.RunUntilStalled();
  EXPECT_FALSE(received_event.has_value()) << "Event should not be received yet";

  // Post resolver
  dispatcher.Post(resolver_task);

  // Run to completion
  dispatcher.RunToCompletion();

  ASSERT_TRUE(received_event.has_value()) << "Event should be received";
  EXPECT_EQ(received_event->type, NfcEventType::kTagArrived);
}

// ============================================================================
// Loop Polling Pattern (simulates WaitForCard)
// ============================================================================

TEST(NfcEventProviderTest, LoopPollingPattern_ReceivesEvent) {
  DispatcherForTest dispatcher;
  ValueProvider<NfcEvent> provider;

  auto future = provider.Get();

  // Simulate a resolver that runs on the "third" poll iteration
  int iteration = 0;
  bool resolved = false;

  for (int i = 0; i < 10; ++i) {
    iteration = i;

    // Simulate the reader task running
    if (i == 3 && !resolved) {
      NfcEvent event{NfcEventType::kTagArrived, nullptr};
      provider.Resolve(std::move(event));
      resolved = true;
    }

    auto poll = dispatcher.RunInTaskUntilStalled(future);
    if (poll.IsReady()) {
      EXPECT_EQ(poll->type, NfcEventType::kTagArrived);
      EXPECT_EQ(iteration, 3) << "Should receive on iteration 3";
      return;  // Success
    }
  }

  FAIL() << "Never received event after " << iteration << " iterations";
}

TEST(NfcEventProviderTest, LoopPollingWithRunUntilStalled_ReceivesEvent) {
  DispatcherForTest dispatcher;
  ValueProvider<NfcEvent> provider;

  auto future = provider.Get();

  // Simulate a reader task that resolves on iteration 3
  // (In the real code, the FSM runs and resolves the event)
  for (int i = 0; i < 10; ++i) {
    // Simulate the reader task resolving on iteration 3
    if (i == 3) {
      NfcEvent event{NfcEventType::kTagArrived, nullptr};
      provider.Resolve(std::move(event));
    }

    // Run pending work
    dispatcher.RunUntilStalled();

    // Poll the future
    auto poll = dispatcher.RunInTaskUntilStalled(future);

    if (poll.IsReady()) {
      EXPECT_EQ(poll->type, NfcEventType::kTagArrived);
      EXPECT_GE(i, 3) << "Should receive on iteration 3 or later";
      return;  // Success
    }
  }

  FAIL() << "Never received event";
}

// ============================================================================
// Test that simulates the actual FSM pattern
// ============================================================================

// The key insight from these tests:
// 1. ValueProvider works correctly
// 2. RunInTaskUntilStalled correctly polls futures
// 3. If Resolve() is called before or between polls, the future sees the value
//
// The issue in the real FSM must be elsewhere - either:
// - The FSM never calls SendTagArrived()
// - The event_provider doesn't have a pending future when Resolve() is called
// - Some other timing issue
//
// The debug logging added to SendTagArrived should reveal which case it is.

// ============================================================================
// Tests for ReEnqueue behavior (DoPend busy-loop fix)
// ============================================================================

// These tests verify the pattern used to prevent busy-looping in DoPend.
// The key insight: a task should only call cx.ReEnqueue() when there's
// actual state-changing work to do. If there's no work, the task waits
// for external events (futures) to wake it.
//
// The PN532 reader's DoPend was previously always calling cx.ReEnqueue(),
// which caused RunUntilStalled() to hang in tests.

TEST(ReEnqueuePatternTest, TaskWithReEnqueue_PollsMultipleTimes) {
  DispatcherForTest dispatcher;

  int poll_count = 0;
  const int max_polls = 5;

  // Task that re-enqueues itself until a condition is met
  pw::async2::PendFuncTask active_task([&](Context& cx) -> Poll<> {
    poll_count++;
    if (poll_count < max_polls) {
      cx.ReEnqueue();  // More work to do
      return Pending();
    }
    return Ready();  // Done
  });

  dispatcher.Post(active_task);

  // RunToCompletion should keep polling until the task is done
  dispatcher.RunToCompletion();

  EXPECT_EQ(poll_count, max_polls) << "Task should be polled multiple times with re-enqueue";
}

TEST(ReEnqueuePatternTest, ConditionalReEnqueue_StopsWithoutWork) {
  DispatcherForTest dispatcher;

  int poll_count = 0;
  int work_items = 3;

  // Task that conditionally re-enqueues based on work availability
  // (simulates the pattern used in Pn532NfcReader::DoPend)
  pw::async2::PendFuncTask conditional_task([&](Context& cx) -> Poll<> {
    poll_count++;

    bool needs_poll = false;

    // Simulate checking for work
    if (work_items > 0) {
      work_items--;
      needs_poll = true;
    }

    // Only re-enqueue if there's more work
    if (needs_poll) {
      cx.ReEnqueue();
      return Pending();
    }

    // No more work - complete the task
    // (In real code, we'd return Pending() and wait for an external event,
    // but for testing we complete to avoid needing a waker)
    return Ready();
  });

  dispatcher.Post(conditional_task);
  dispatcher.RunToCompletion();

  // Should poll 4 times: 3 with work (re-enqueue), 1 without (complete)
  EXPECT_EQ(poll_count, 4) << "Task should poll until work is exhausted";
  EXPECT_EQ(work_items, 0) << "All work should be processed";
}

}  // namespace
}  // namespace maco::nfc
