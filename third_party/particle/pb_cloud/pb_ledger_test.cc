// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include <array>

#include "mock_ledger_backend.h"
#include "pb_cloud/cbor.h"
#include "pb_cloud/ledger_backend.h"
#include "pb_cloud/ledger_typed_api.h"
#include "pb_cloud/ledger_types.h"
#include "pw_unit_test/framework.h"

namespace pb::cloud {
namespace {

// -- LedgerHandle Tests --

TEST(LedgerHandle, DefaultConstructorCreatesInvalidHandle) {
  LedgerHandle handle;
  EXPECT_FALSE(handle.is_valid());
  EXPECT_FALSE(static_cast<bool>(handle));
}

TEST(LedgerHandle, GetLedgerReturnsValidHandle) {
  MockLedgerBackend backend;
  auto result = backend.GetLedger("test-ledger");

  ASSERT_TRUE(result.ok());
  EXPECT_TRUE(result.value().is_valid());
}

TEST(LedgerHandle, MoveConstructorTransfersOwnership) {
  MockLedgerBackend backend;
  auto result = backend.GetLedger("test-ledger");
  ASSERT_TRUE(result.ok());

  LedgerHandle moved(std::move(result.value()));
  EXPECT_TRUE(moved.is_valid());
  EXPECT_FALSE(result.value().is_valid());
}

TEST(LedgerHandle, MoveAssignmentTransfersOwnership) {
  MockLedgerBackend backend;
  auto result = backend.GetLedger("test-ledger");
  ASSERT_TRUE(result.ok());

  LedgerHandle moved;
  moved = std::move(result.value());
  EXPECT_TRUE(moved.is_valid());
  EXPECT_FALSE(result.value().is_valid());
}

// -- LedgerBackend Read/Write Tests --

TEST(LedgerBackend, WriteAndReadRoundTrip) {
  MockLedgerBackend backend;
  const std::byte test_data[] = {std::byte{0x01}, std::byte{0x02},
                                 std::byte{0x03}};

  // Write data
  {
    auto handle = backend.GetLedger("test-ledger");
    ASSERT_TRUE(handle.ok());
    auto status = handle.value().Write(test_data);
    EXPECT_TRUE(status.ok());
  }

  // Read data back
  {
    auto handle = backend.GetLedger("test-ledger");
    ASSERT_TRUE(handle.ok());

    std::array<std::byte, 16> buffer{};
    auto result = handle.value().Read(buffer);
    ASSERT_TRUE(result.ok());
    EXPECT_EQ(result.value(), 3u);
    EXPECT_EQ(buffer[0], std::byte{0x01});
    EXPECT_EQ(buffer[1], std::byte{0x02});
    EXPECT_EQ(buffer[2], std::byte{0x03});
  }
}

TEST(LedgerBackend, GetInfoReturnsMetadata) {
  MockLedgerBackend backend;

  LedgerInfo info;
  info.scope = LedgerScope::kDevice;
  info.sync_direction = SyncDirection::kDeviceToCloud;
  info.last_updated = 12345;
  info.data_size = 100;
  backend.SetLedgerInfo("test-ledger", info);

  auto handle = backend.GetLedger("test-ledger");
  ASSERT_TRUE(handle.ok());

  auto result = handle.value().GetInfo();
  ASSERT_TRUE(result.ok());
  EXPECT_EQ(std::string_view(result.value().name), "test-ledger");
  EXPECT_EQ(result.value().scope, LedgerScope::kDevice);
  EXPECT_EQ(result.value().sync_direction, SyncDirection::kDeviceToCloud);
}

TEST(LedgerBackend, InvalidHandleReturnsError) {
  LedgerHandle invalid;

  auto info_result = invalid.GetInfo();
  EXPECT_FALSE(info_result.ok());
  EXPECT_EQ(info_result.status(), pw::Status::FailedPrecondition());

  std::array<std::byte, 16> buffer;
  auto read_result = invalid.Read(buffer);
  EXPECT_FALSE(read_result.ok());
  EXPECT_EQ(read_result.status(), pw::Status::FailedPrecondition());

  auto write_result = invalid.Write(pw::ConstByteSpan());
  EXPECT_FALSE(write_result.ok());
  EXPECT_EQ(write_result, pw::Status::FailedPrecondition());
}

// -- Ledger Management Tests --

TEST(LedgerBackend, GetLedgerNamesReturnsAllLedgers) {
  MockLedgerBackend backend;

  // Create some ledgers
  const std::byte dummy[] = {std::byte{0x00}};
  backend.SetLedgerData("ledger-a", dummy);
  backend.SetLedgerData("ledger-b", dummy);
  backend.SetLedgerData("ledger-c", dummy);

  pw::Vector<pw::InlineString<kMaxLedgerNameSize>, kMaxLedgerCount> names;
  auto status = backend.GetLedgerNames(names);

  ASSERT_TRUE(status.ok());
  EXPECT_EQ(names.size(), 3u);
}

TEST(LedgerBackend, PurgeClearsLedgerData) {
  MockLedgerBackend backend;
  const std::byte test_data[] = {std::byte{0xFF}};
  backend.SetLedgerData("test-ledger", test_data);

  auto status = backend.Purge("test-ledger");
  EXPECT_TRUE(status.ok());

  auto written = backend.GetWrittenData("test-ledger");
  EXPECT_EQ(written.size(), 0u);
}

TEST(LedgerBackend, PurgeNonExistentReturnsNotFound) {
  MockLedgerBackend backend;
  auto status = backend.Purge("non-existent");
  EXPECT_EQ(status, pw::Status::NotFound());
}

TEST(LedgerBackend, PurgeAllClearsAllLedgers) {
  MockLedgerBackend backend;
  const std::byte test_data[] = {std::byte{0xFF}};
  backend.SetLedgerData("ledger-a", test_data);
  backend.SetLedgerData("ledger-b", test_data);

  auto status = backend.PurgeAll();
  EXPECT_TRUE(status.ok());

  EXPECT_EQ(backend.GetWrittenData("ledger-a").size(), 0u);
  EXPECT_EQ(backend.GetWrittenData("ledger-b").size(), 0u);
}

// -- Typed API Tests --

TEST(LedgerTypedApi, ReadWriteStringRoundTrip) {
  MockLedgerBackend backend;

  std::string_view original = "Hello, Ledger!";
  auto write_status = WriteLedger(backend, "test-ledger", original);
  EXPECT_TRUE(write_status.ok());

  auto read_result = ReadLedger<std::string_view>(backend, "test-ledger");
  ASSERT_TRUE(read_result.ok());
  EXPECT_EQ(read_result.value(), original);
}

TEST(LedgerTypedApi, ReadNonExistentLedgerSucceeds) {
  MockLedgerBackend backend;

  // MockLedgerBackend creates ledgers on access, so this returns empty data
  auto result = ReadLedger<std::string_view>(backend, "non-existent");
  ASSERT_TRUE(result.ok());
  EXPECT_TRUE(result.value().empty());
}

// -- Mock Backend Reset Tests --

TEST(MockLedgerBackend, ResetClearsAllState) {
  MockLedgerBackend backend;
  const std::byte test_data[] = {std::byte{0x01}};
  backend.SetLedgerData("test-ledger", test_data);

  backend.Reset();

  EXPECT_EQ(backend.ledger_count(), 0u);
}

// -- Property API Tests (CBOR) --

TEST(LedgerHandle, GetBoolProperty) {
  MockLedgerBackend backend;

  // Set up CBOR data: {"enabled": true, "disabled": false}
  std::array<std::byte, 64> buffer{};
  cbor::Encoder encoder(buffer);
  ASSERT_TRUE(encoder.BeginMap(2).ok());
  ASSERT_TRUE(encoder.WriteBool("enabled", true).ok());
  ASSERT_TRUE(encoder.WriteBool("disabled", false).ok());
  backend.SetLedgerData("test", pw::ConstByteSpan(buffer.data(), encoder.size()));

  auto handle = backend.GetLedger("test");
  ASSERT_TRUE(handle.ok());

  EXPECT_TRUE(handle.value().GetBool("enabled", false));
  EXPECT_FALSE(handle.value().GetBool("disabled", true));
  EXPECT_TRUE(handle.value().GetBool("missing", true));  // default
}

TEST(LedgerHandle, GetIntProperty) {
  MockLedgerBackend backend;

  std::array<std::byte, 64> buffer{};
  cbor::Encoder encoder(buffer);
  ASSERT_TRUE(encoder.BeginMap(2).ok());
  ASSERT_TRUE(encoder.WriteInt("positive", 42).ok());
  ASSERT_TRUE(encoder.WriteInt("negative", -100).ok());
  backend.SetLedgerData("test", pw::ConstByteSpan(buffer.data(), encoder.size()));

  auto handle = backend.GetLedger("test");
  ASSERT_TRUE(handle.ok());

  EXPECT_EQ(handle.value().GetInt("positive", 0), 42);
  EXPECT_EQ(handle.value().GetInt("negative", 0), -100);
  EXPECT_EQ(handle.value().GetInt64("positive", 0), 42);
  EXPECT_EQ(handle.value().GetInt64("negative", 0), -100);
}

TEST(LedgerHandle, GetUintProperty) {
  MockLedgerBackend backend;

  std::array<std::byte, 64> buffer{};
  cbor::Encoder encoder(buffer);
  ASSERT_TRUE(encoder.BeginMap(1).ok());
  ASSERT_TRUE(encoder.WriteUint("count", 12345).ok());
  backend.SetLedgerData("test", pw::ConstByteSpan(buffer.data(), encoder.size()));

  auto handle = backend.GetLedger("test");
  ASSERT_TRUE(handle.ok());

  EXPECT_EQ(handle.value().GetUint("count", 0), 12345u);
  EXPECT_EQ(handle.value().GetUint64("count", 0), 12345u);
}

TEST(LedgerHandle, GetDoubleProperty) {
  MockLedgerBackend backend;

  std::array<std::byte, 64> buffer{};
  cbor::Encoder encoder(buffer);
  ASSERT_TRUE(encoder.BeginMap(1).ok());
  ASSERT_TRUE(encoder.WriteDouble("pi", 3.14159).ok());
  backend.SetLedgerData("test", pw::ConstByteSpan(buffer.data(), encoder.size()));

  auto handle = backend.GetLedger("test");
  ASSERT_TRUE(handle.ok());

  EXPECT_NEAR(handle.value().GetDouble("pi", 0.0), 3.14159, 0.0001);
}

TEST(LedgerHandle, GetStringProperty) {
  MockLedgerBackend backend;

  std::array<std::byte, 64> buffer{};
  cbor::Encoder encoder(buffer);
  ASSERT_TRUE(encoder.BeginMap(1).ok());
  ASSERT_TRUE(encoder.WriteString("name", "Terminal-01").ok());
  backend.SetLedgerData("test", pw::ConstByteSpan(buffer.data(), encoder.size()));

  auto handle = backend.GetLedger("test");
  ASSERT_TRUE(handle.ok());

  std::array<char, 32> str_buf{};
  auto result = handle.value().GetString("name",
      pw::as_writable_bytes(pw::span(str_buf)));
  ASSERT_TRUE(result.ok());
  EXPECT_EQ(std::string_view(str_buf.data(), result.value()), "Terminal-01");
}

TEST(LedgerHandle, GetBytesProperty) {
  MockLedgerBackend backend;

  std::byte raw[] = {std::byte{0xDE}, std::byte{0xAD}, std::byte{0xBE},
                     std::byte{0xEF}};
  std::array<std::byte, 64> buffer{};
  cbor::Encoder encoder(buffer);
  ASSERT_TRUE(encoder.BeginMap(1).ok());
  ASSERT_TRUE(encoder.WriteBytes("raw", raw).ok());
  backend.SetLedgerData("test", pw::ConstByteSpan(buffer.data(), encoder.size()));

  auto handle = backend.GetLedger("test");
  ASSERT_TRUE(handle.ok());

  std::array<std::byte, 8> bytes_buf{};
  auto result = handle.value().GetBytes("raw", bytes_buf);
  ASSERT_TRUE(result.ok());
  EXPECT_EQ(result.value(), 4u);
  EXPECT_EQ(bytes_buf[0], std::byte{0xDE});
  EXPECT_EQ(bytes_buf[3], std::byte{0xEF});
}

TEST(LedgerHandle, HasProperty) {
  MockLedgerBackend backend;

  std::array<std::byte, 64> buffer{};
  cbor::Encoder encoder(buffer);
  ASSERT_TRUE(encoder.BeginMap(1).ok());
  ASSERT_TRUE(encoder.WriteBool("exists", true).ok());
  backend.SetLedgerData("test", pw::ConstByteSpan(buffer.data(), encoder.size()));

  auto handle = backend.GetLedger("test");
  ASSERT_TRUE(handle.ok());

  EXPECT_TRUE(handle.value().Has("exists"));
  EXPECT_FALSE(handle.value().Has("missing"));
}

// -- LedgerEditor Tests --

TEST(LedgerEditor, SetAndCommitProperties) {
  MockLedgerBackend backend;

  // Create ledger and edit
  auto handle = backend.GetLedger("test");
  ASSERT_TRUE(handle.ok());

  std::array<std::byte, 4096> buffer{};
  auto editor_result = handle.value().Edit(buffer);
  ASSERT_TRUE(editor_result.ok());

  auto& editor = editor_result.value();
  ASSERT_TRUE(editor.SetBool("enabled", true).ok());
  ASSERT_TRUE(editor.SetInt("count", 42).ok());
  ASSERT_TRUE(editor.SetString("name", "Test").ok());
  ASSERT_TRUE(editor.Commit().ok());

  // Read back via new handle
  auto handle2 = backend.GetLedger("test");
  ASSERT_TRUE(handle2.ok());

  EXPECT_TRUE(handle2.value().GetBool("enabled", false));
  EXPECT_EQ(handle2.value().GetInt("count", 0), 42);

  std::array<char, 32> name_buf{};
  auto name_result = handle2.value().GetString("name",
      pw::as_writable_bytes(pw::span(name_buf)));
  ASSERT_TRUE(name_result.ok());
  EXPECT_EQ(std::string_view(name_buf.data(), name_result.value()), "Test");
}

TEST(LedgerEditor, ModifyExistingProperties) {
  MockLedgerBackend backend;

  // Create initial data
  {
    std::array<std::byte, 64> buffer{};
    cbor::Encoder encoder(buffer);
    ASSERT_TRUE(encoder.BeginMap(2).ok());
    ASSERT_TRUE(encoder.WriteBool("enabled", false).ok());
    ASSERT_TRUE(encoder.WriteInt("count", 0).ok());
    backend.SetLedgerData("test",
        pw::ConstByteSpan(buffer.data(), encoder.size()));
  }

  // Modify
  auto handle = backend.GetLedger("test");
  ASSERT_TRUE(handle.ok());

  std::array<std::byte, 4096> buffer{};
  auto editor_result = handle.value().Edit(buffer);
  ASSERT_TRUE(editor_result.ok());

  auto& editor = editor_result.value();
  ASSERT_TRUE(editor.SetBool("enabled", true).ok());
  ASSERT_TRUE(editor.SetInt("count", 99).ok());
  ASSERT_TRUE(editor.Commit().ok());

  // Verify
  auto handle2 = backend.GetLedger("test");
  EXPECT_TRUE(handle2.value().GetBool("enabled", false));
  EXPECT_EQ(handle2.value().GetInt("count", 0), 99);
}

TEST(LedgerEditor, RemoveProperty) {
  MockLedgerBackend backend;

  // Create initial data with two properties
  {
    std::array<std::byte, 64> buffer{};
    cbor::Encoder encoder(buffer);
    ASSERT_TRUE(encoder.BeginMap(2).ok());
    ASSERT_TRUE(encoder.WriteBool("keep", true).ok());
    ASSERT_TRUE(encoder.WriteBool("remove", true).ok());
    backend.SetLedgerData("test",
        pw::ConstByteSpan(buffer.data(), encoder.size()));
  }

  // Remove one property
  auto handle = backend.GetLedger("test");
  ASSERT_TRUE(handle.ok());

  std::array<std::byte, 4096> buffer{};
  auto editor_result = handle.value().Edit(buffer);
  ASSERT_TRUE(editor_result.ok());

  auto& editor = editor_result.value();
  ASSERT_TRUE(editor.Remove("remove").ok());
  ASSERT_TRUE(editor.Commit().ok());

  // Verify
  auto handle2 = backend.GetLedger("test");
  EXPECT_TRUE(handle2.value().Has("keep"));
  EXPECT_FALSE(handle2.value().Has("remove"));
}

TEST(LedgerEditor, PropertyCount) {
  MockLedgerBackend backend;

  auto handle = backend.GetLedger("test");
  ASSERT_TRUE(handle.ok());

  std::array<std::byte, 4096> buffer{};
  auto editor_result = handle.value().Edit(buffer);
  ASSERT_TRUE(editor_result.ok());

  auto& editor = editor_result.value();
  EXPECT_EQ(editor.property_count(), 0u);

  ASSERT_TRUE(editor.SetBool("a", true).ok());
  EXPECT_EQ(editor.property_count(), 1u);

  ASSERT_TRUE(editor.SetBool("b", true).ok());
  EXPECT_EQ(editor.property_count(), 2u);

  ASSERT_TRUE(editor.Remove("a").ok());
  EXPECT_EQ(editor.property_count(), 1u);
}

// -- Mock Backend Property Helpers Tests --

TEST(MockLedgerBackend, SetAndGetPropertyHelpers) {
  MockLedgerBackend backend;

  // Test without double first to see if that's the issue
  backend.SetProperty("test", "enabled", true);
  EXPECT_TRUE(backend.GetPropertyBool("test", "enabled", false)) << "After bool";

  backend.SetProperty("test", "count", int64_t{42});
  EXPECT_TRUE(backend.HasProperty("test", "enabled")) << "After int: has enabled";
  EXPECT_TRUE(backend.HasProperty("test", "count")) << "After int: has count";

  std::string_view name_value = "Terminal-01";
  backend.SetProperty("test", "name", name_value);
  EXPECT_TRUE(backend.HasProperty("test", "enabled")) << "After str: has enabled";
  EXPECT_TRUE(backend.HasProperty("test", "count")) << "After str: has count";
  EXPECT_TRUE(backend.HasProperty("test", "name")) << "After str: has name";

  // Now add double and check again
  backend.SetProperty("test", "threshold", 0.95);
  EXPECT_TRUE(backend.HasProperty("test", "enabled")) << "After double: has enabled";
  EXPECT_TRUE(backend.HasProperty("test", "count")) << "After double: has count";
  EXPECT_TRUE(backend.HasProperty("test", "name")) << "After double: has name";
  EXPECT_TRUE(backend.HasProperty("test", "threshold")) << "After double: has threshold";
}

// -- Large Property Tests --

TEST(LedgerEditor, LargeStringProperty) {
  MockLedgerBackend backend;

  auto handle = backend.GetLedger("test");
  ASSERT_TRUE(handle.ok());

  // Create a string that's ~200 bytes
  std::array<char, 200> large_string{};
  std::fill(large_string.begin(), large_string.end(), 'x');
  std::string_view large_view(large_string.data(), large_string.size());

  std::array<std::byte, 512> buffer{};
  auto editor_result = handle.value().Edit(buffer);
  ASSERT_TRUE(editor_result.ok());

  auto& editor = editor_result.value();
  ASSERT_TRUE(editor.SetString("large", large_view).ok());
  ASSERT_TRUE(editor.Commit().ok());

  // Read back
  std::array<char, 256> read_buf{};
  auto result = handle.value().GetString(
      "large", pw::as_writable_bytes(pw::span(read_buf)));
  ASSERT_TRUE(result.ok());
  EXPECT_EQ(result.value(), 200u);
  EXPECT_EQ(std::string_view(read_buf.data(), 200), large_view);
}

TEST(LedgerEditor, LargeBytesProperty) {
  MockLedgerBackend backend;

  auto handle = backend.GetLedger("test");
  ASSERT_TRUE(handle.ok());

  // Create bytes that are ~150 bytes
  std::array<std::byte, 150> large_bytes{};
  for (size_t i = 0; i < large_bytes.size(); ++i) {
    large_bytes[i] = static_cast<std::byte>(i & 0xff);
  }

  std::array<std::byte, 512> buffer{};
  auto editor_result = handle.value().Edit(buffer);
  ASSERT_TRUE(editor_result.ok());

  auto& editor = editor_result.value();
  ASSERT_TRUE(editor.SetBytes("data", large_bytes).ok());
  ASSERT_TRUE(editor.Commit().ok());

  // Read back
  std::array<std::byte, 200> read_buf{};
  auto result = handle.value().GetBytes("data", read_buf);
  ASSERT_TRUE(result.ok());
  EXPECT_EQ(result.value(), 150u);
  EXPECT_EQ(std::memcmp(read_buf.data(), large_bytes.data(), 150), 0);
}

TEST(LedgerEditor, BufferExhaustion) {
  MockLedgerBackend backend;

  auto handle = backend.GetLedger("test");
  ASSERT_TRUE(handle.ok());

  // Use a very small buffer
  std::array<std::byte, 64> buffer{};
  auto editor_result = handle.value().Edit(buffer);
  ASSERT_TRUE(editor_result.ok());

  auto& editor = editor_result.value();

  // This should succeed (small value)
  ASSERT_TRUE(editor.SetBool("a", true).ok());

  // Try to add a string that's too large for the remaining buffer
  // Buffer is 64 bytes, half reserved for CBOR output, so ~32 bytes for strings
  // Key "a" + bool already used some, plus key "big" needs space
  std::array<char, 50> large_string{};
  std::fill(large_string.begin(), large_string.end(), 'y');
  std::string_view large_view(large_string.data(), large_string.size());

  // This should fail due to buffer exhaustion
  auto status = editor.SetString("big", large_view);
  EXPECT_FALSE(status.ok());
  EXPECT_EQ(status.code(), pw::Status::ResourceExhausted().code());
}

TEST(LedgerEditor, PropertyCountLimit) {
  MockLedgerBackend backend;

  auto handle = backend.GetLedger("test");
  ASSERT_TRUE(handle.ok());

  std::array<std::byte, 4096> buffer{};
  auto editor_result = handle.value().Edit(buffer);
  ASSERT_TRUE(editor_result.ok());

  auto& editor = editor_result.value();

  // Add properties up to the limit (kMaxLedgerProperties = 16)
  for (size_t i = 0; i < kMaxLedgerProperties; ++i) {
    char key[8];
    snprintf(key, sizeof(key), "p%zu", i);
    ASSERT_TRUE(editor.SetInt(key, static_cast<int64_t>(i)).ok())
        << "Failed at property " << i;
  }
  EXPECT_EQ(editor.property_count(), kMaxLedgerProperties);

  // Adding one more should fail
  auto status = editor.SetInt("overflow", 999);
  EXPECT_FALSE(status.ok());
  EXPECT_EQ(status.code(), pw::Status::ResourceExhausted().code());
}

TEST(LedgerEditor, RoundTripLargeString) {
  MockLedgerBackend backend;

  // First write a large string
  {
    auto handle = backend.GetLedger("test");
    ASSERT_TRUE(handle.ok());

    std::array<char, 100> str_data{};
    std::fill(str_data.begin(), str_data.end(), 'z');
    std::string_view str_view(str_data.data(), str_data.size());

    std::array<std::byte, 256> buffer{};
    auto editor = handle.value().Edit(buffer);
    ASSERT_TRUE(editor.ok());
    ASSERT_TRUE(editor.value().SetString("msg", str_view).ok());
    ASSERT_TRUE(editor.value().SetInt("num", 42).ok());
    ASSERT_TRUE(editor.value().Commit().ok());
  }

  // Now edit again - the large string should be parsed correctly
  {
    auto handle = backend.GetLedger("test");
    ASSERT_TRUE(handle.ok());

    std::array<std::byte, 256> buffer{};
    auto editor = handle.value().Edit(buffer);
    ASSERT_TRUE(editor.ok());

    // Should have 2 properties from previous write
    EXPECT_EQ(editor.value().property_count(), 2u);

    // Add a new property and commit
    ASSERT_TRUE(editor.value().SetBool("flag", true).ok());
    EXPECT_EQ(editor.value().property_count(), 3u);
    ASSERT_TRUE(editor.value().Commit().ok());
  }

  // Verify all properties
  {
    auto handle = backend.GetLedger("test");
    ASSERT_TRUE(handle.ok());

    EXPECT_EQ(handle.value().GetInt("num", 0), 42);
    EXPECT_TRUE(handle.value().GetBool("flag", false));

    std::array<char, 128> read_buf{};
    auto result = handle.value().GetString(
        "msg", pw::as_writable_bytes(pw::span(read_buf)));
    ASSERT_TRUE(result.ok());
    EXPECT_EQ(result.value(), 100u);
  }
}

}  // namespace
}  // namespace pb::cloud
