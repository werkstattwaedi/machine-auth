// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include <string_view>

#include "pb_cloud/cloud.h"
#include "mock_cloud_backend.h"
#include "pw_unit_test/framework.h"

namespace pb::cloud {
namespace {

class CloudBackendTest : public ::testing::Test {
 protected:
  void TearDown() override { mock_.Reset(); }

  MockCloudBackend mock_;
};

// -- Publish Tests --

TEST_F(CloudBackendTest, PublishRecordsEventData) {
  constexpr auto kData = std::array<std::byte, 5>{
      std::byte{'h'}, std::byte{'e'}, std::byte{'l'},
      std::byte{'l'}, std::byte{'o'}};

  auto future = mock_.Publish("test/event", pw::ConstByteSpan(kData), {});

  EXPECT_EQ(mock_.last_published().name, "test/event");
  EXPECT_EQ(mock_.last_published().data.size(), 5u);
  EXPECT_EQ(mock_.publish_count(), 1u);
}

TEST_F(CloudBackendTest, PublishRecordsOptions) {
  PublishOptions options;
  options.scope = EventScope::kPublic;
  options.ack = AckMode::kNoAck;
  options.content_type = ContentType::kBinary;
  options.ttl_seconds = 120;

  auto future = mock_.Publish("test", pw::ConstByteSpan(), options);

  EXPECT_EQ(mock_.last_published().options.scope, EventScope::kPublic);
  EXPECT_EQ(mock_.last_published().options.ack, AckMode::kNoAck);
  EXPECT_EQ(mock_.last_published().options.content_type, ContentType::kBinary);
  EXPECT_EQ(mock_.last_published().options.ttl_seconds, 120);
}

TEST_F(CloudBackendTest, PublishCountIncrements) {
  mock_.Publish("a", pw::ConstByteSpan(), {});
  mock_.Publish("b", pw::ConstByteSpan(), {});
  mock_.Publish("c", pw::ConstByteSpan(), {});

  EXPECT_EQ(mock_.publish_count(), 3u);
}

// -- Subscription Tests --

TEST_F(CloudBackendTest, SubscribeRecordsPrefix) {
  auto receiver = mock_.Subscribe("device/");

  EXPECT_EQ(mock_.subscription_prefix(), "device/");
}

// -- Variable Registration Tests --

TEST_F(CloudBackendTest, RegisterVariableRecordsDetails) {
  // Simple API: just pass name and initial value
  auto& var = mock_.RegisterVariable("myVar", 42);

  EXPECT_EQ(mock_.last_variable().name, "myVar");
  EXPECT_EQ(mock_.last_variable().type, VariableType::kInt);
  EXPECT_EQ(mock_.variable_count(), 1u);

  // The returned reference allows updating the value
  var.Set(100);
  EXPECT_EQ(var.Get(), 100);
}

TEST_F(CloudBackendTest, RegisterVariableDeducesTypes) {
  mock_.RegisterVariable("bool", true);
  EXPECT_EQ(mock_.last_variable().type, VariableType::kBool);

  mock_.RegisterVariable("double", 3.14);
  EXPECT_EQ(mock_.last_variable().type, VariableType::kDouble);

  mock_.RegisterVariable("int", 42);
  EXPECT_EQ(mock_.last_variable().type, VariableType::kInt);
}

TEST_F(CloudBackendTest, RegisterStringVariable) {
  auto& str_var = mock_.RegisterStringVariable("status", "ready");

  EXPECT_EQ(mock_.last_variable().type, VariableType::kString);
  EXPECT_EQ(str_var.Get(), "ready");

  str_var.Set("busy");
  EXPECT_EQ(str_var.Get(), "busy");
}

// -- Function Registration Tests --

TEST_F(CloudBackendTest, RegisterFunctionRecordsDetails) {
  auto status = mock_.RegisterFunction(
      "myFunc", [](std::string_view) { return 0; });

  EXPECT_TRUE(status.ok());
  EXPECT_EQ(mock_.last_function().name, "myFunc");
  EXPECT_EQ(mock_.function_count(), 1u);
}

TEST_F(CloudBackendTest, CallFunctionInvokesPwFunction) {
  int call_count = 0;
  auto status = mock_.RegisterFunction(
      "counter", [&call_count](std::string_view arg) {
        ++call_count;
        return static_cast<int>(arg.size());
      });
  EXPECT_TRUE(status.ok());

  // Simulate cloud calling the function
  int result = mock_.CallFunction("counter", "hello");

  EXPECT_EQ(call_count, 1);
  EXPECT_EQ(result, 5);  // "hello".size()
}

TEST_F(CloudBackendTest, CallFunctionReturnsErrorForUnknown) {
  int result = mock_.CallFunction("unknown", "arg");
  EXPECT_EQ(result, -1);
}

TEST_F(CloudBackendTest, RegisterFunctionWithCapture) {
  int captured_value = 42;
  auto status = mock_.RegisterFunction(
      "getCapture", [&captured_value](std::string_view) {
        return captured_value;
      });
  EXPECT_TRUE(status.ok());

  EXPECT_EQ(mock_.CallFunction("getCapture", ""), 42);

  captured_value = 100;
  EXPECT_EQ(mock_.CallFunction("getCapture", ""), 100);
}

// -- Serializer Tests --

TEST(SerializerTest, StringSerializerRoundTrip) {
  std::string_view input = "hello world";
  std::array<std::byte, 64> buffer;

  auto size = Serializer<std::string_view>::Serialize(input, buffer);
  ASSERT_TRUE(size.ok());
  EXPECT_EQ(size.value(), 11u);

  auto decoded = Serializer<std::string_view>::Deserialize(
      pw::ConstByteSpan(buffer.data(), size.value()));
  ASSERT_TRUE(decoded.ok());
  EXPECT_EQ(decoded.value(), "hello world");
}

TEST(SerializerTest, StringSerializerBufferTooSmall) {
  std::string_view input = "hello";
  std::array<std::byte, 3> buffer;  // Too small

  auto result = Serializer<std::string_view>::Serialize(input, buffer);
  EXPECT_EQ(result.status(), pw::Status::ResourceExhausted());
}

TEST(SerializerTest, ByteSpanSerializerRoundTrip) {
  constexpr auto kInput = std::array<std::byte, 4>{
      std::byte{0x01}, std::byte{0x02}, std::byte{0x03}, std::byte{0x04}};
  std::array<std::byte, 64> buffer;

  auto size = Serializer<pw::ConstByteSpan>::Serialize(kInput, buffer);
  ASSERT_TRUE(size.ok());
  EXPECT_EQ(size.value(), 4u);

  auto decoded = Serializer<pw::ConstByteSpan>::Deserialize(
      pw::ConstByteSpan(buffer.data(), size.value()));
  ASSERT_TRUE(decoded.ok());
  EXPECT_EQ(decoded.value().size(), 4u);
}

// -- Types Tests --

TEST(TypesTest, ReceivedEventOwnsData) {
  ReceivedEvent event;
  event.name = "test/event";
  event.data.resize(3);
  event.data[0] = std::byte{'a'};
  event.data[1] = std::byte{'b'};
  event.data[2] = std::byte{'c'};
  event.content_type = ContentType::kText;

  // Verify the event owns its data (InlineString and Vector)
  EXPECT_EQ(event.name, "test/event");
  EXPECT_EQ(event.data.size(), 3u);
  EXPECT_EQ(event.data[0], std::byte{'a'});
}

TEST(TypesTest, PublishOptionsDefaults) {
  PublishOptions options;

  EXPECT_EQ(options.scope, EventScope::kPrivate);
  EXPECT_EQ(options.ack, AckMode::kWithAck);
  EXPECT_EQ(options.content_type, ContentType::kText);
  EXPECT_EQ(options.ttl_seconds, 60);
}

}  // namespace
}  // namespace pb::cloud
