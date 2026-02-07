// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pb_cloud/particle_cloud_backend.h"

#include <cstring>

#include "pw_assert/check.h"
#include "spark_wiring_string.h"
#include "system_cloud.h"

#define PW_LOG_MODULE_NAME "pb_cloud"

#include "pw_log/log.h"

namespace pb::cloud {
namespace {

// -- Threading Model --
// Particle Device OS runs all application code and callbacks on the same
// system thread. Event callbacks (OnEventReceived, OnPublishComplete) and
// cloud function invocations are serialized with application code.
// No synchronization is needed for accessing shared state.

/// Instance pointer for trampoline access.
/// Set when Instance() is first called, never cleared (singleton lives forever).
ParticleCloudBackend* g_instance = nullptr;

// -- Static Function Trampolines --
// Particle requires raw C function pointers. We use 15 static trampolines
// that dispatch to pw::Function handlers stored in the backend instance.

/// Static trampoline for slot N - dispatches to instance handler.
/// Note: Particle cloud functions receive a String object (not const char*).
#define DEFINE_TRAMPOLINE(N)                                               \
  int FunctionTrampoline##N(String arg) {                                  \
    const char* arg_cstr = arg.c_str();                                    \
    PW_LOG_INFO("Trampoline%d called, arg=%s", N,                          \
                arg_cstr ? arg_cstr : "(null)");                           \
    if (!g_instance || !g_instance->GetHandler(N)) {                       \
      PW_LOG_ERROR("Trampoline%d: handler is null!", N);                   \
      return -1;                                                           \
    }                                                                      \
    int result = g_instance->GetHandler(N)(                                \
        std::string_view(arg_cstr, arg.length()));                         \
    PW_LOG_INFO("Trampoline%d returned %d", N, result);                    \
    return result;                                                         \
  }

DEFINE_TRAMPOLINE(0)
DEFINE_TRAMPOLINE(1)
DEFINE_TRAMPOLINE(2)
DEFINE_TRAMPOLINE(3)
DEFINE_TRAMPOLINE(4)
DEFINE_TRAMPOLINE(5)
DEFINE_TRAMPOLINE(6)
DEFINE_TRAMPOLINE(7)
DEFINE_TRAMPOLINE(8)
DEFINE_TRAMPOLINE(9)
DEFINE_TRAMPOLINE(10)
DEFINE_TRAMPOLINE(11)
DEFINE_TRAMPOLINE(12)
DEFINE_TRAMPOLINE(13)
DEFINE_TRAMPOLINE(14)

#undef DEFINE_TRAMPOLINE

/// Array of trampoline function pointers for registration with Particle.
/// Type matches user_function_int_str_t: int(String)
constexpr std::array<user_function_int_str_t*, kMaxCloudFunctions>
    kTrampolines = {
        FunctionTrampoline0,  FunctionTrampoline1,  FunctionTrampoline2,
        FunctionTrampoline3,  FunctionTrampoline4,  FunctionTrampoline5,
        FunctionTrampoline6,  FunctionTrampoline7,  FunctionTrampoline8,
        FunctionTrampoline9,  FunctionTrampoline10, FunctionTrampoline11,
        FunctionTrampoline12, FunctionTrampoline13, FunctionTrampoline14,
};

}  // namespace

// -- Singleton Implementation --

ParticleCloudBackend& ParticleCloudBackend::Instance() {
  static ParticleCloudBackend instance;
  return instance;
}

// -- ParticleCloudBackend Implementation --

ParticleCloudBackend::ParticleCloudBackend() {
  g_instance = this;
  PW_LOG_INFO("ParticleCloudBackend constructed at %p",
              static_cast<void*>(this));

  // Log trampoline addresses for debugging
  PW_LOG_INFO("Trampoline array:");
  for (int i = 0; i < 3; ++i) {
    PW_LOG_INFO("  kTrampolines[%d] = 0x%08x", i,
                reinterpret_cast<unsigned int>(kTrampolines[i]));
  }
}

ParticleCloudBackend::~ParticleCloudBackend() {
  PW_LOG_INFO("ParticleCloudBackend destructing");
}

PublishFuture ParticleCloudBackend::Publish(std::string_view name,
                                            pw::ConstByteSpan data,
                                            const PublishOptions& options) {
  // Build flags
  uint32_t flags = 0;
  if (options.scope == EventScope::kPrivate) {
    flags |= PUBLISH_EVENT_FLAG_PRIVATE;
  }
  if (options.ack == AckMode::kWithAck) {
    flags |= PUBLISH_EVENT_FLAG_WITH_ACK;
  }

  // Copy name to null-terminated string
  pw::InlineString<kMaxEventNameSize> name_str(name);

  // Set up completion handler
  spark_send_event_data extra{};
  extra.size = sizeof(extra);
  extra.data_size = data.size();
  extra.content_type = static_cast<int>(options.content_type);
  extra.handler_callback = &OnPublishComplete;
  extra.handler_data = &publish_provider_;

  PW_LOG_INFO("Publish: name=%s, data_size=%zu, flags=0x%x", name_str.c_str(),
              data.size(), static_cast<unsigned>(flags));

  // Start the publish
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  bool started = spark_send_event(name_str.c_str(),
                                  reinterpret_cast<const char*>(data.data()),
                                  options.ttl_seconds, flags, &extra);

  PW_LOG_INFO("Publish: spark_send_event returned %s",
              started ? "true" : "false");

  if (!started) {
    // Publish failed to start (e.g., not connected)
    publish_provider_.Resolve(pw::Status::Unavailable());
  }

  return publish_provider_.Get();
}

EventReceiver ParticleCloudBackend::Subscribe(std::string_view prefix) {
  // Copy prefix for subscription
  subscription_prefix_ = pw::InlineString<kMaxEventNameSize>(prefix);

  // Check cloud connection status
  bool connected = spark_cloud_flag_connected();
  PW_LOG_INFO("Subscribe: cloud_connected=%s", connected ? "true" : "false");

  PW_LOG_INFO("Subscribe: prefix='%s', handler=%p", subscription_prefix_.c_str(),
              reinterpret_cast<void*>(&OnEventReceived));

  // Use simplest form: no handler_data, no extra params
  bool success = spark_subscribe(subscription_prefix_.c_str(), &OnEventReceived,
                                 nullptr,     // handler_data
                                 MY_DEVICES,  // deprecated, ignored
                                 nullptr,     // deprecated, ignored
                                 nullptr);    // no extra params

  PW_LOG_INFO("Subscribe: spark_subscribe returned %s",
              success ? "true" : "false");

  if (!success) {
    PW_LOG_ERROR("Failed to subscribe to %s", subscription_prefix_.c_str());
  }

  // Recreate channel to get a fresh receiver
  return CreateSubscriptionReceiver();
}

pw::Status ParticleCloudBackend::RegisterFunction(std::string_view name,
                                                  CloudFunction&& handler) {
  PW_CHECK(function_count_ < kMaxCloudFunctions,
           "Max cloud functions (%d) exceeded",
           static_cast<int>(kMaxCloudFunctions));

  // Store handler in slot
  size_t slot = function_count_;
  function_handlers_[slot] = std::move(handler);

  // Copy name to null-terminated string
  pw::InlineString<64> name_str(name);

  // Get the trampoline function pointer
  auto trampoline_fn = kTrampolines[slot];

  PW_LOG_INFO("RegisterFunction: name=%s, slot=%d", name_str.c_str(),
              static_cast<int>(slot));
  PW_LOG_INFO("RegisterFunction: trampoline addr=0x%08x",
              reinterpret_cast<unsigned int>(trampoline_fn));
  PW_LOG_INFO("RegisterFunction: handler_set=%s",
              function_handlers_[slot] ? "true" : "false");

  // Verify trampoline is not null
  if (trampoline_fn == nullptr) {
    PW_LOG_ERROR("RegisterFunction: trampoline is NULL!");
    return pw::Status::Internal();
  }

  // Register trampoline with Particle
  bool success = spark_function(name_str.c_str(), trampoline_fn, nullptr);

  PW_LOG_INFO("RegisterFunction: spark_function returned %s",
              success ? "true" : "false");

  if (!success) {
    PW_LOG_ERROR("Failed to register function %s", name_str.c_str());
    // Clear the handler if registration failed
    function_handlers_[slot] = nullptr;
    return pw::Status::Internal();
  }

  ++function_count_;
  return pw::OkStatus();
}

pw::Status ParticleCloudBackend::DoRegisterVariable(
    std::string_view name,
    const void* data,
    VariableType type,
    std::unique_ptr<void, VariableDeleter> storage) {
  if (variable_count_ >= kMaxCloudVariables) {
    PW_LOG_ERROR("Max cloud variables reached (%zu)", kMaxCloudVariables);
    return pw::Status::ResourceExhausted();
  }

  // Copy name to null-terminated string
  pw::InlineString<64> name_str(name);

  Spark_Data_TypeDef spark_type;
  switch (type) {
    case VariableType::kBool:
      spark_type = CLOUD_VAR_BOOLEAN;
      break;
    case VariableType::kInt:
      spark_type = CLOUD_VAR_INT;
      break;
    case VariableType::kString:
      spark_type = CLOUD_VAR_STRING;
      break;
    case VariableType::kDouble:
      spark_type = CLOUD_VAR_DOUBLE;
      break;
    default:
      PW_LOG_ERROR("Invalid variable type");
      return pw::Status::InvalidArgument();
  }

  PW_LOG_INFO("RegisterVariable: name=%s, data=%p, type=%d, spark_type=%d",
              name_str.c_str(), data, static_cast<int>(type),
              static_cast<int>(spark_type));

  // Log the actual value for debugging (assuming int for now)
  if (type == VariableType::kInt) {
    PW_LOG_INFO("RegisterVariable: int value = %d",
                *static_cast<const int*>(data));
  }

  bool success = spark_variable(name_str.c_str(), data, spark_type, nullptr);

  PW_LOG_INFO("RegisterVariable: spark_variable returned %s",
              success ? "true" : "false");

  if (!success) {
    PW_LOG_ERROR("Failed to register variable %s", name_str.c_str());
    return pw::Status::Internal();
  }

  // Store ownership of the variable container
  variable_storage_[variable_count_] =
      std::shared_ptr<void>(storage.release(), storage.get_deleter());
  ++variable_count_;

  PW_LOG_INFO("RegisterVariable: success, variable_count=%d",
              static_cast<int>(variable_count_));
  return pw::OkStatus();
}

EventReceiver ParticleCloudBackend::CreateSubscriptionReceiver() {
  // Release any existing channel by resetting the handle first
  if (event_sender_.is_open()) {
    event_sender_.Disconnect();
  }
  event_channel_handle_ = {};  // Destroy old handle to release storage

  // Create a fresh channel
  auto [handle, sender, receiver] =
      pw::async2::CreateSpscChannel<ReceivedEvent>(event_channel_storage_);
  event_channel_handle_ = std::move(handle);
  event_sender_ = std::move(sender);
  return std::move(receiver);
}

void ParticleCloudBackend::OnPublishComplete(int error,
                                             const void* /*data*/,
                                             void* callback_data,
                                             void* /*reserved*/) {
  PW_LOG_INFO("OnPublishComplete: error=%d, callback_data=%p", error,
              callback_data);
  auto* provider =
      static_cast<pw::async2::ValueProvider<pw::Status>*>(callback_data);
  if (provider) {
    provider->Resolve(error == 0 ? pw::OkStatus() : pw::Status::Unknown());
    PW_LOG_INFO("OnPublishComplete: resolved provider");
  } else {
    PW_LOG_ERROR("OnPublishComplete: callback_data is null!");
  }
}

void ParticleCloudBackend::OnEventReceived(const char* event_name,
                                           const char* data) {
  // This is called from the Particle system thread (same as application code).
  // We push events into the channel for the consumer to receive.
  PW_LOG_INFO("OnEventReceived: name=%s, data=%s",
              event_name ? event_name : "(null)", data ? data : "(null)");

  auto& self = Instance();

  ReceivedEvent event;
  event.name = pw::InlineString<kMaxEventNameSize>(event_name);

  // Copy data (null-terminated string for simple EventHandler)
  size_t data_len = data ? std::strlen(data) : 0;
  size_t copy_len = std::min(data_len, event.data.max_size());
  event.data.resize(copy_len);
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  std::memcpy(event.data.data(), reinterpret_cast<const std::byte*>(data),
              copy_len);

  event.content_type = ContentType::kText;

  // Push event into channel (non-blocking)
  if (self.event_sender_.is_open()) {
    auto status = self.event_sender_.TrySend(std::move(event));
    PW_LOG_INFO("OnEventReceived: TrySend status=%d",
                static_cast<int>(status.code()));
  } else {
    PW_LOG_WARN("OnEventReceived: channel not open, event dropped");
  }
}

}  // namespace pb::cloud
