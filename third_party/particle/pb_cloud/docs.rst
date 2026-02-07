.. _module-pb_cloud:

========
pb_cloud
========
Typed cloud communication APIs for Particle Cloud.

This module provides a dependency-injectable interface for publishing events,
subscribing to cloud events, and registering cloud variables and functions.
All operations are async-first using ``pw_async2``.

-----
Design
-----
The module follows a layered architecture:

.. code-block:: text

   ┌─────────────────────────────────────────────────────────┐
   │  Typed API: PublishTyped<T, Serializer>()               │
   │             PublishProto<Proto>()                       │
   ├─────────────────────────────────────────────────────────┤
   │  Serializers: StringSerializer, ProtoSerializer<Msg>    │
   ├─────────────────────────────────────────────────────────┤
   │  CloudBackend (virtual interface)                       │
   │  ├── Publish(name, data) → PublishFuture               │
   │  ├── Subscribe(prefix) → EventReceiver                 │
   │  ├── RegisterVariable(name, initial) → reference       │
   │  └── RegisterFunction(name, handler) → Status          │
   ├─────────────────────────────────────────────────────────┤
   │  Implementations:                                       │
   │  ├── ParticleCloudBackend (spark_* dynalib)            │
   │  └── MockCloudBackend (for testing)                    │
   └─────────────────────────────────────────────────────────┘

Key design decisions:

- **Dependency injection**: ``CloudBackend`` interface enables testing with ``MockCloudBackend``
- **Async-only**: All publish operations return futures; subscriptions use channels
- **Owning data**: ``ReceivedEvent`` owns its data (no dangling pointers)
- **Copy on publish**: ``Publish()`` copies data internally; caller's buffer is safe to free

-----
Setup
-----
Add the dependency to your BUILD.bazel:

.. code-block:: python

   # For application code (uses CloudBackend interface)
   deps = [
       "@particle_bazel//pb_cloud",
   ]

   # For P2 device (adds ParticleCloudBackend implementation)
   deps = [
       "@particle_bazel//pb_cloud",
       "@particle_bazel//pb_cloud:pb_cloud_particle_backend",
   ]

   # For tests (adds MockCloudBackend)
   deps = [
       "@particle_bazel//pb_cloud",
       "@particle_bazel//pb_cloud:mock_cloud_backend",
   ]

-----
Usage
-----

Basic Setup with Dependency Injection
=====================================
.. code-block:: cpp

   #include "pb_cloud/cloud_backend.h"
   #include "pb_cloud/particle_cloud_backend.h"  // P2 only

   class MyComponent {
    public:
     explicit MyComponent(pb::cloud::CloudBackend& cloud) : cloud_(cloud) {}

     void PublishStatus(pw::ConstByteSpan data) {
       auto future = cloud_.Publish("device/status", data, {});
       // Poll future in async loop...
     }

    private:
     pb::cloud::CloudBackend& cloud_;
   };

   // Application wiring (P2):
   auto& cloud = pb::cloud::ParticleCloudBackend::Instance();
   MyComponent component(cloud);

Publishing Events
=================
All publish operations are asynchronous and return a future:

.. code-block:: cpp

   #include "pb_cloud/cloud_backend.h"

   class TelemetryTask : public pw::async2::Task {
     pw::async2::Poll<> DoPend(pw::async2::Context& cx) override {
       if (!publish_future_) {
         pb::cloud::PublishOptions options;
         options.scope = pb::cloud::EventScope::kPrivate;
         options.ack = pb::cloud::AckMode::kWithAck;

         publish_future_.emplace(
             cloud_.Publish("device/telemetry", data_, options));
       }

       auto poll = publish_future_->Pend(cx);
       if (poll.IsPending()) return pw::async2::Pending();

       if (!poll.value().ok()) {
         PW_LOG_ERROR("Publish failed: %s", poll.value().str());
       }
       publish_future_.reset();
       return pw::async2::Ready();
     }

     pb::cloud::CloudBackend& cloud_;
     std::optional<pb::cloud::PublishFuture> publish_future_;
     pw::ConstByteSpan data_;
   };

Typed Publishing with Serializers
=================================
Use ``PublishTyped`` for automatic serialization:

.. code-block:: cpp

   #include "pb_cloud/typed_api.h"

   // String data
   auto future = pb::cloud::PublishTyped(
       cloud, "device/status", std::string_view("online"));

   // Protobuf message
   #include "pb_cloud/proto_serializer.h"

   SensorReading::Message reading{.temperature = 25, .humidity = 60};
   auto future = pb::cloud::PublishProto<SensorReading>(
       cloud, "sensor/reading", reading);

Subscribing to Events
=====================
Subscriptions use ``pw_async2`` channels for buffered, non-blocking delivery:

.. code-block:: cpp

   class CommandReceiverTask : public pw::async2::Task {
    public:
     CommandReceiverTask(pb::cloud::CloudBackend& cloud)
         : receiver_(cloud.Subscribe("device/command")) {}

     pw::async2::Poll<> DoPend(pw::async2::Context& cx) override {
       if (!receive_future_) {
         receive_future_.emplace(receiver_.Receive());
       }

       auto poll = receive_future_->Pend(cx);
       if (poll.IsPending()) return pw::async2::Pending();

       auto event_opt = std::move(poll.value());
       if (!event_opt) {
         // Channel closed - subscription ended
         return pw::async2::Ready();
       }

       PW_LOG_INFO("Received: %s", event_opt->name.c_str());
       HandleCommand(event_opt->data);

       receive_future_.reset();
       return pw::async2::Pending();  // Keep running
     }

    private:
     pb::cloud::EventReceiver receiver_;
     std::optional<pw::async2::ReceiveFuture<pb::cloud::ReceivedEvent>>
         receive_future_;
   };

Cloud Variables
===============
Register variables that can be read from the Particle Console or API:

.. code-block:: cpp

   // Register at startup
   auto& temperature = cloud.RegisterVariable("temperature", 25);
   auto& status = cloud.RegisterStringVariable("status", "ready");

   // Update values at runtime
   temperature.Set(30);
   status.Set("busy");

   // Read current value
   int temp = temperature.Get();

Variables are owned by the backend - the returned reference remains valid
for the lifetime of the backend.

Cloud Functions
===============
Register functions that can be called from the Particle Console or API:

.. code-block:: cpp

   // Lambda with capture
   cloud.RegisterFunction("setMode", [this](std::string_view arg) {
     if (arg == "active") {
       SetActive();
       return 0;  // Success
     }
     return -1;  // Error
   });

   // Lambda without capture
   cloud.RegisterFunction("reset", [](std::string_view) {
     PerformReset();
     return 0;
   });

Functions support ``pw::Function``, allowing lambdas with captures.
Up to 15 functions can be registered (Particle limit).

-----
Testing
-----
Use ``MockCloudBackend`` for unit testing:

.. code-block:: cpp

   #include "mock_cloud_backend.h"
   #include "pw_unit_test/framework.h"

   class CloudTest : public ::testing::Test {
    protected:
     void TearDown() override { mock_.Reset(); }
     pb::cloud::MockCloudBackend mock_;
   };

   TEST_F(CloudTest, PublishCapturesData) {
     constexpr auto kData = std::array<std::byte, 5>{
         std::byte{'h'}, std::byte{'e'}, std::byte{'l'},
         std::byte{'l'}, std::byte{'o'}};

     auto future = mock_.Publish("test/event", kData, {});

     EXPECT_EQ(mock_.last_published().name, "test/event");
     EXPECT_EQ(mock_.last_published().data.size(), 5u);
     EXPECT_EQ(mock_.publish_count(), 1u);

     // Complete the publish
     mock_.SimulatePublishSuccess();
   }

   TEST_F(CloudTest, FunctionCallsHandler) {
     int call_count = 0;
     mock_.RegisterFunction("counter", [&](std::string_view arg) {
       ++call_count;
       return static_cast<int>(arg.size());
     });

     int result = mock_.CallFunction("counter", "hello");

     EXPECT_EQ(call_count, 1);
     EXPECT_EQ(result, 5);
   }

   TEST_F(CloudTest, SubscribeReceivesEvents) {
     auto receiver = mock_.Subscribe("device/");

     mock_.SimulateEventReceived("device/command", command_data);

     // Poll receiver to get event...
   }

Mock Simulation Helpers
=======================
- ``SimulatePublishSuccess()`` - Complete pending publish with success
- ``SimulatePublishFailure(status)`` - Complete pending publish with error
- ``SimulateEventReceived(name, data)`` - Inject event into subscription
- ``CloseSubscription()`` - Close the subscription channel
- ``CallFunction(name, arg)`` - Invoke a registered function

Mock Inspection Methods
=======================
- ``last_published()`` - Get details of last publish call
- ``publish_count()`` - Number of publish calls
- ``subscription_prefix()`` - Current subscription prefix
- ``last_variable()`` / ``variable_count()`` - Variable registration info
- ``last_function()`` / ``function_count()`` - Function registration info

-----
API Reference
-----

Types
=====
.. cpp:enum-class:: pb::cloud::EventScope : uint8_t

   Event visibility scope.

   .. cpp:enumerator:: kPrivate

      Only visible to owner's devices.

   .. cpp:enumerator:: kPublic

      Visible to all devices.

.. cpp:enum-class:: pb::cloud::AckMode : uint8_t

   Acknowledgement mode for publish operations.

   .. cpp:enumerator:: kNoAck

      Fire and forget, no delivery confirmation.

   .. cpp:enumerator:: kWithAck

      Wait for cloud acknowledgement.

.. cpp:enum-class:: pb::cloud::ContentType : int

   Content type for event data.

   .. cpp:enumerator:: kText = 0

      Plain text (UTF-8).

   .. cpp:enumerator:: kBinary = 42

      Binary data.

   .. cpp:enumerator:: kStructured = 65400

      Structured data (CBOR/protobuf).

.. cpp:struct:: pb::cloud::PublishOptions

   Options for publish operations.

   .. cpp:member:: EventScope scope = EventScope::kPrivate
   .. cpp:member:: AckMode ack = AckMode::kWithAck
   .. cpp:member:: ContentType content_type = ContentType::kText
   .. cpp:member:: int ttl_seconds = 60

.. cpp:struct:: pb::cloud::ReceivedEvent

   Received cloud event with owning data.

   .. cpp:member:: pw::InlineString<64> name

      Event name (owned copy).

   .. cpp:member:: pw::Vector<std::byte, 1024> data

      Event data (owned copy).

   .. cpp:member:: ContentType content_type

CloudBackend Interface
======================
.. cpp:function:: PublishFuture pb::cloud::CloudBackend::Publish(std::string_view name, pw::ConstByteSpan data, const PublishOptions& options)

   Publish event data to cloud.

   :param name: Event name (max 64 chars)
   :param data: Binary payload (will be copied internally)
   :param options: Publish options
   :returns: Future that resolves to ``pw::Status`` when publish completes

.. cpp:function:: EventReceiver pb::cloud::CloudBackend::Subscribe(std::string_view prefix)

   Subscribe to cloud events matching prefix.

   :param prefix: Event name prefix to match (e.g., "device/")
   :returns: Receiver handle for receiving events

.. cpp:function:: template<typename T> CloudVariable<T>& pb::cloud::CloudBackend::RegisterVariable(std::string_view name, T initial = T{})

   Register a cloud-readable variable.

   :param name: Variable name (max 64 chars)
   :param initial: Initial value
   :returns: Reference to the stored variable for updating
   :crashes: If max variables (20) exceeded

.. cpp:function:: template<size_t kMaxSize> CloudStringVariable<kMaxSize>& pb::cloud::CloudBackend::RegisterStringVariable(std::string_view name, std::string_view initial = "")

   Register a cloud-readable string variable.

   :param name: Variable name (max 64 chars)
   :param initial: Initial string value
   :returns: Reference to the stored variable for updating
   :crashes: If max variables (20) exceeded

.. cpp:function:: pw::Status pb::cloud::CloudBackend::RegisterFunction(std::string_view name, CloudFunction&& handler)

   Register a cloud-callable function.

   :param name: Function name (max 64 chars)
   :param handler: Callable to invoke (supports lambdas with captures)
   :returns: ``OkStatus()`` on success, ``ResourceExhausted`` if max functions (15) reached

-----
Constants
-----
.. cpp:var:: constexpr size_t pb::cloud::kMaxEventNameSize = 64

   Maximum event name length (Particle limit).

.. cpp:var:: constexpr size_t pb::cloud::kMaxEventDataSize = 1024

   Maximum event data size (Particle limit).

.. cpp:var:: constexpr size_t pb::cloud::kMaxCloudFunctions = 15

   Maximum number of cloud functions (Particle limit).

.. cpp:var:: constexpr size_t pb::cloud::kMaxCloudVariables = 20

   Maximum number of cloud variables (Particle limit).

.. cpp:var:: constexpr size_t pb::cloud::kMaxStringVariableSize = 622

   Maximum string variable size (Particle limit).

-----
Threading Model
-----
Particle Device OS runs all application code and callbacks on the same system
thread. Event callbacks (subscription events, publish completion, function
invocations) are serialized with application code. No synchronization is
needed when accessing ``CloudBackend`` state.

-----
Bazel Targets
-----
- ``//pb_cloud`` - Core types and CloudBackend interface (header-only)
- ``//pb_cloud:pb_cloud_particle_backend`` - Particle implementation (P2 only)
- ``//pb_cloud:mock_cloud_backend`` - Mock for testing (testonly)
- ``//pb_cloud:pb_cloud_test`` - Unit tests
