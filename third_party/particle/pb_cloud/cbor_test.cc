// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pb_cloud/cbor.h"

#include <array>
#include <cmath>

#include "pw_unit_test/framework.h"

namespace pb::cloud::cbor {
namespace {

// -- Encoder Tests --

TEST(CborEncoder, EmptyMap) {
  std::array<std::byte, 16> buffer{};
  Encoder encoder(buffer);

  auto status = encoder.BeginMap(0);
  ASSERT_TRUE(status.ok());
  EXPECT_EQ(encoder.size(), 1u);
  // Empty map: 0xa0
  EXPECT_EQ(buffer[0], std::byte{0xa0});
}

TEST(CborEncoder, MapWithBool) {
  std::array<std::byte, 32> buffer{};
  Encoder encoder(buffer);

  ASSERT_TRUE(encoder.BeginMap(2).ok());
  ASSERT_TRUE(encoder.WriteBool("enabled", true).ok());
  ASSERT_TRUE(encoder.WriteBool("disabled", false).ok());

  // Expected:
  // a2                     # map(2)
  //   67 656e61626c6564    # text(7) "enabled"
  //   f5                   # true
  //   68 64697361626c6564  # text(8) "disabled"
  //   f4                   # false
  EXPECT_EQ(buffer[0], std::byte{0xa2});  // map(2)
  EXPECT_EQ(buffer[1], std::byte{0x67});  // text(7)
  EXPECT_EQ(buffer[9], std::byte{0xf5});  // true
  EXPECT_EQ(buffer[10], std::byte{0x68}); // text(8)
  EXPECT_EQ(buffer[19], std::byte{0xf4}); // false
}

TEST(CborEncoder, SmallIntegers) {
  std::array<std::byte, 32> buffer{};
  Encoder encoder(buffer);

  ASSERT_TRUE(encoder.BeginMap(3).ok());
  ASSERT_TRUE(encoder.WriteInt("a", 0).ok());
  ASSERT_TRUE(encoder.WriteInt("b", 23).ok());
  ASSERT_TRUE(encoder.WriteInt("c", 24).ok());

  // 0 encodes as 0x00
  // 23 encodes as 0x17
  // 24 encodes as 0x18 0x18
  EXPECT_EQ(buffer[3], std::byte{0x00});   // 0
  EXPECT_EQ(buffer[6], std::byte{0x17});   // 23
  EXPECT_EQ(buffer[9], std::byte{0x18});   // 24 marker
  EXPECT_EQ(buffer[10], std::byte{0x18});  // 24 value
}

TEST(CborEncoder, NegativeIntegers) {
  std::array<std::byte, 32> buffer{};
  Encoder encoder(buffer);

  ASSERT_TRUE(encoder.BeginMap(3).ok());
  ASSERT_TRUE(encoder.WriteInt("a", -1).ok());
  ASSERT_TRUE(encoder.WriteInt("b", -10).ok());
  ASSERT_TRUE(encoder.WriteInt("c", -100).ok());

  // -1 encodes as 0x20 (type 1, value 0)
  // -10 encodes as 0x29 (type 1, value 9)
  // -100 encodes as 0x38 0x63 (type 1, value 99)
  EXPECT_EQ(buffer[3], std::byte{0x20});   // -1
  EXPECT_EQ(buffer[6], std::byte{0x29});   // -10
  EXPECT_EQ(buffer[9], std::byte{0x38});   // -100 marker
  EXPECT_EQ(buffer[10], std::byte{0x63});  // 99
}

TEST(CborEncoder, LargeUint) {
  std::array<std::byte, 32> buffer{};
  Encoder encoder(buffer);

  ASSERT_TRUE(encoder.BeginMap(1).ok());
  ASSERT_TRUE(encoder.WriteUint("n", 256).ok());

  // 256 encodes as 0x19 0x01 0x00 (2-byte form)
  EXPECT_EQ(buffer[3], std::byte{0x19});  // 2-byte marker
  EXPECT_EQ(buffer[4], std::byte{0x01});
  EXPECT_EQ(buffer[5], std::byte{0x00});
}

TEST(CborEncoder, Double) {
  std::array<std::byte, 32> buffer{};
  Encoder encoder(buffer);

  ASSERT_TRUE(encoder.BeginMap(1).ok());
  ASSERT_TRUE(encoder.WriteDouble("pi", 3.14159).ok());

  // a1       map(1)
  // 62       text(2)
  // 70 69    "pi"
  // fb       float64
  // ...      8 bytes IEEE 754
  EXPECT_EQ(buffer[0], std::byte{0xa1});  // map(1)
  EXPECT_EQ(buffer[1], std::byte{0x62});  // text(2)
  EXPECT_EQ(buffer[4], std::byte{0xfb});  // float64 marker
}

TEST(CborEncoder, String) {
  std::array<std::byte, 64> buffer{};
  Encoder encoder(buffer);

  ASSERT_TRUE(encoder.BeginMap(1).ok());
  ASSERT_TRUE(encoder.WriteString("msg", "Hello").ok());

  // "msg" = text(3), "Hello" = text(5)
  EXPECT_EQ(buffer[1], std::byte{0x63});  // text(3)
  EXPECT_EQ(buffer[5], std::byte{0x65});  // text(5)
  EXPECT_EQ(buffer[6], std::byte{'H'});
}

TEST(CborEncoder, Bytes) {
  std::array<std::byte, 32> buffer{};
  Encoder encoder(buffer);

  std::byte raw[] = {std::byte{0xDE}, std::byte{0xAD}, std::byte{0xBE},
                     std::byte{0xEF}};

  ASSERT_TRUE(encoder.BeginMap(1).ok());
  ASSERT_TRUE(encoder.WriteBytes("raw", raw).ok());

  // bytes(4) = 0x44
  EXPECT_EQ(buffer[5], std::byte{0x44});
  EXPECT_EQ(buffer[6], std::byte{0xDE});
}

TEST(CborEncoder, Null) {
  std::array<std::byte, 32> buffer{};
  Encoder encoder(buffer);

  ASSERT_TRUE(encoder.BeginMap(1).ok());
  ASSERT_TRUE(encoder.WriteNull("empty").ok());

  // null = 0xf6
  EXPECT_EQ(buffer[7], std::byte{0xf6});
}

TEST(CborEncoder, BufferTooSmall) {
  std::array<std::byte, 4> buffer{};
  Encoder encoder(buffer);

  ASSERT_TRUE(encoder.BeginMap(1).ok());
  auto status = encoder.WriteString("this_key_is_way_too_long", "value");
  EXPECT_EQ(status, pw::Status::ResourceExhausted());
}

// -- Decoder Tests --

TEST(CborDecoder, EmptyMap) {
  std::byte data[] = {std::byte{0xa0}};
  Decoder decoder(data);

  auto count = decoder.ReadMapHeader();
  ASSERT_TRUE(count.ok());
  EXPECT_EQ(count.value(), 0u);
  EXPECT_FALSE(decoder.HasNext());
}

TEST(CborDecoder, MapWithBool) {
  // {"enabled": true}
  std::byte data[] = {
      std::byte{0xa1},  // map(1)
      std::byte{0x67},  // text(7)
      std::byte{'e'},   std::byte{'n'}, std::byte{'a'}, std::byte{'b'},
      std::byte{'l'},   std::byte{'e'}, std::byte{'d'},
      std::byte{0xf5},  // true
  };
  Decoder decoder(data);

  auto count = decoder.ReadMapHeader();
  ASSERT_TRUE(count.ok());
  EXPECT_EQ(count.value(), 1u);

  std::array<char, 16> key_buf{};
  auto key = decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));
  ASSERT_TRUE(key.ok());
  EXPECT_EQ(key.value(), "enabled");

  auto value = decoder.ReadBool();
  ASSERT_TRUE(value.ok());
  EXPECT_TRUE(value.value());
}

TEST(CborDecoder, PositiveInt) {
  // {"n": 42}
  std::byte data[] = {
      std::byte{0xa1},  // map(1)
      std::byte{0x61},  // text(1)
      std::byte{'n'},
      std::byte{0x18}, std::byte{42},  // uint(42)
  };
  Decoder decoder(data);

  auto count = decoder.ReadMapHeader();
  ASSERT_TRUE(count.ok());

  std::array<char, 8> key_buf{};
  auto key = decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));
  ASSERT_TRUE(key.ok());

  auto value = decoder.ReadInt();
  ASSERT_TRUE(value.ok());
  EXPECT_EQ(value.value(), 42);
}

TEST(CborDecoder, NegativeInt) {
  // {"n": -10}
  std::byte data[] = {
      std::byte{0xa1},  // map(1)
      std::byte{0x61},  // text(1)
      std::byte{'n'},
      std::byte{0x29},  // neg(-10) = -1-9
  };
  Decoder decoder(data);

  auto count = decoder.ReadMapHeader();
  ASSERT_TRUE(count.ok());

  std::array<char, 8> key_buf{};
  decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));

  auto value = decoder.ReadInt();
  ASSERT_TRUE(value.ok());
  EXPECT_EQ(value.value(), -10);
}

TEST(CborDecoder, Double) {
  // {"pi": 3.14159}
  // 0xfb + IEEE 754 big-endian for 3.14159
  std::byte data[] = {
      std::byte{0xa1},  // map(1)
      std::byte{0x62},  // text(2)
      std::byte{'p'}, std::byte{'i'},
      std::byte{0xfb},  // float64
      std::byte{0x40}, std::byte{0x09}, std::byte{0x21}, std::byte{0xf9},
      std::byte{0xf0}, std::byte{0x1b}, std::byte{0x86}, std::byte{0x6e},
  };
  Decoder decoder(data);

  decoder.ReadMapHeader();
  std::array<char, 8> key_buf{};
  decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));

  auto value = decoder.ReadDouble();
  ASSERT_TRUE(value.ok());
  EXPECT_NEAR(value.value(), 3.14159, 0.00001);
}

TEST(CborDecoder, String) {
  // {"msg": "hello"}
  std::byte data[] = {
      std::byte{0xa1},  // map(1)
      std::byte{0x63},  // text(3)
      std::byte{'m'}, std::byte{'s'}, std::byte{'g'},
      std::byte{0x65},  // text(5)
      std::byte{'h'}, std::byte{'e'}, std::byte{'l'}, std::byte{'l'},
      std::byte{'o'},
  };
  Decoder decoder(data);

  decoder.ReadMapHeader();
  std::array<char, 8> key_buf{};
  decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));

  std::array<char, 16> value_buf{};
  auto len = decoder.ReadString(pw::as_writable_bytes(pw::span(value_buf)));
  ASSERT_TRUE(len.ok());
  EXPECT_EQ(len.value(), 5u);
  EXPECT_EQ(std::string_view(value_buf.data(), len.value()), "hello");
}

TEST(CborDecoder, Bytes) {
  // {"raw": h'DEADBEEF'}
  std::byte data[] = {
      std::byte{0xa1},  // map(1)
      std::byte{0x63},  // text(3)
      std::byte{'r'}, std::byte{'a'}, std::byte{'w'},
      std::byte{0x44},  // bytes(4)
      std::byte{0xDE}, std::byte{0xAD}, std::byte{0xBE}, std::byte{0xEF},
  };
  Decoder decoder(data);

  decoder.ReadMapHeader();
  std::array<char, 8> key_buf{};
  decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));

  std::array<std::byte, 8> value_buf{};
  auto len = decoder.ReadBytes(value_buf);
  ASSERT_TRUE(len.ok());
  EXPECT_EQ(len.value(), 4u);
  EXPECT_EQ(value_buf[0], std::byte{0xDE});
  EXPECT_EQ(value_buf[3], std::byte{0xEF});
}

TEST(CborDecoder, SkipValue) {
  // {"skip": "ignored", "want": 42}
  std::byte data[] = {
      std::byte{0xa2},  // map(2)
      std::byte{0x64},  // text(4)
      std::byte{'s'}, std::byte{'k'}, std::byte{'i'}, std::byte{'p'},
      std::byte{0x67},  // text(7)
      std::byte{'i'}, std::byte{'g'}, std::byte{'n'}, std::byte{'o'},
      std::byte{'r'}, std::byte{'e'}, std::byte{'d'},
      std::byte{0x64},  // text(4)
      std::byte{'w'}, std::byte{'a'}, std::byte{'n'}, std::byte{'t'},
      std::byte{0x18}, std::byte{42},  // uint(42)
  };
  Decoder decoder(data);

  auto count = decoder.ReadMapHeader();
  ASSERT_TRUE(count.ok());
  EXPECT_EQ(count.value(), 2u);

  // Read first key
  std::array<char, 16> key_buf{};
  auto key1 = decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));
  ASSERT_TRUE(key1.ok());
  EXPECT_EQ(key1.value(), "skip");

  // Skip the value
  ASSERT_TRUE(decoder.SkipValue().ok());

  // Read second key
  auto key2 = decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));
  ASSERT_TRUE(key2.ok());
  EXPECT_EQ(key2.value(), "want");

  // Read the value we want
  auto value = decoder.ReadInt();
  ASSERT_TRUE(value.ok());
  EXPECT_EQ(value.value(), 42);
}

TEST(CborDecoder, IntAsDouble) {
  // ReadDouble should work for integer values
  std::byte data[] = {
      std::byte{0xa1},  // map(1)
      std::byte{0x61},  // text(1)
      std::byte{'n'},
      std::byte{0x18}, std::byte{42},  // uint(42)
  };
  Decoder decoder(data);

  decoder.ReadMapHeader();
  std::array<char, 8> key_buf{};
  decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));

  auto value = decoder.ReadDouble();
  ASSERT_TRUE(value.ok());
  EXPECT_EQ(value.value(), 42.0);
}

TEST(CborDecoder, PeekType) {
  std::byte data[] = {
      std::byte{0xa1},  // map(1)
      std::byte{0x61},  // text(1)
      std::byte{'n'},
      std::byte{0xf5},  // true
  };
  Decoder decoder(data);

  auto type = decoder.PeekType();
  ASSERT_TRUE(type.ok());
  EXPECT_EQ(type.value(), MajorType::kMap);

  // Peek shouldn't consume
  type = decoder.PeekType();
  ASSERT_TRUE(type.ok());
  EXPECT_EQ(type.value(), MajorType::kMap);
}

// -- Round-trip Tests --

TEST(CborRoundTrip, AllTypes) {
  std::array<std::byte, 256> buffer{};
  Encoder encoder(buffer);

  ASSERT_TRUE(encoder.BeginMap(7).ok());
  ASSERT_TRUE(encoder.WriteNull("null_val").ok());
  ASSERT_TRUE(encoder.WriteBool("bool_val", true).ok());
  ASSERT_TRUE(encoder.WriteInt("int_val", -42).ok());
  ASSERT_TRUE(encoder.WriteUint("uint_val", 1000).ok());
  ASSERT_TRUE(encoder.WriteDouble("double_val", 3.14).ok());
  ASSERT_TRUE(encoder.WriteString("str_val", "hello").ok());
  std::byte raw[] = {std::byte{0xAB}, std::byte{0xCD}};
  ASSERT_TRUE(encoder.WriteBytes("bytes_val", raw).ok());

  // Decode
  Decoder decoder(pw::ConstByteSpan(buffer.data(), encoder.size()));
  auto count = decoder.ReadMapHeader();
  ASSERT_TRUE(count.ok());
  EXPECT_EQ(count.value(), 7u);

  std::array<char, 32> key_buf{};

  // null_val (skip the null)
  auto key = decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));
  EXPECT_EQ(key.value(), "null_val");
  ASSERT_TRUE(decoder.SkipValue().ok());

  // bool_val
  key = decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));
  EXPECT_EQ(key.value(), "bool_val");
  auto bool_val = decoder.ReadBool();
  ASSERT_TRUE(bool_val.ok());
  EXPECT_TRUE(bool_val.value());

  // int_val
  key = decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));
  EXPECT_EQ(key.value(), "int_val");
  auto int_val = decoder.ReadInt();
  ASSERT_TRUE(int_val.ok());
  EXPECT_EQ(int_val.value(), -42);

  // uint_val
  key = decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));
  EXPECT_EQ(key.value(), "uint_val");
  auto uint_val = decoder.ReadUint();
  ASSERT_TRUE(uint_val.ok());
  EXPECT_EQ(uint_val.value(), 1000u);

  // double_val
  key = decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));
  EXPECT_EQ(key.value(), "double_val");
  auto double_val = decoder.ReadDouble();
  ASSERT_TRUE(double_val.ok());
  EXPECT_NEAR(double_val.value(), 3.14, 0.001);

  // str_val
  key = decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));
  EXPECT_EQ(key.value(), "str_val");
  std::array<char, 32> str_buf{};
  auto str_len = decoder.ReadString(pw::as_writable_bytes(pw::span(str_buf)));
  ASSERT_TRUE(str_len.ok());
  EXPECT_EQ(std::string_view(str_buf.data(), str_len.value()), "hello");

  // bytes_val
  key = decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));
  EXPECT_EQ(key.value(), "bytes_val");
  std::array<std::byte, 8> bytes_buf{};
  auto bytes_len = decoder.ReadBytes(bytes_buf);
  ASSERT_TRUE(bytes_len.ok());
  EXPECT_EQ(bytes_len.value(), 2u);
  EXPECT_EQ(bytes_buf[0], std::byte{0xAB});
  EXPECT_EQ(bytes_buf[1], std::byte{0xCD});
}

// Test the exact format from the plan document
TEST(CborRoundTrip, ParticleFormat) {
  // {"enabled": true, "count": 42}
  std::array<std::byte, 32> buffer{};
  Encoder encoder(buffer);

  ASSERT_TRUE(encoder.BeginMap(2).ok());
  ASSERT_TRUE(encoder.WriteBool("enabled", true).ok());
  ASSERT_TRUE(encoder.WriteInt("count", 42).ok());

  // Verify the exact encoding
  // a2                     # map(2)
  //   67 656e61626c6564    # text(7) "enabled"
  //   f5                   # true
  //   65 636f756e74        # text(5) "count"
  //   18 2a                # unsigned(42)
  EXPECT_EQ(buffer[0], std::byte{0xa2});  // map(2)
  EXPECT_EQ(buffer[1], std::byte{0x67});  // text(7)
  // "enabled" = 65 6e 61 62 6c 65 64
  EXPECT_EQ(buffer[2], std::byte{0x65});  // 'e'
  EXPECT_EQ(buffer[8], std::byte{0x64});  // 'd'
  EXPECT_EQ(buffer[9], std::byte{0xf5});  // true
  EXPECT_EQ(buffer[10], std::byte{0x65}); // text(5)
  // "count" = 63 6f 75 6e 74
  EXPECT_EQ(buffer[15], std::byte{0x74}); // 't'
  EXPECT_EQ(buffer[16], std::byte{0x18}); // unsigned (1-byte follows)
  EXPECT_EQ(buffer[17], std::byte{0x2a}); // 42
}

// -- PeekStringLength Tests --

TEST(CborDecoder, PeekStringLengthSmall) {
  // text(5) "hello"
  constexpr std::array<std::byte, 6> data = {
      std::byte{0x65},  // text(5)
      std::byte{'h'}, std::byte{'e'}, std::byte{'l'},
      std::byte{'l'}, std::byte{'o'}};
  Decoder decoder(data);

  auto len = decoder.PeekStringLength();
  ASSERT_TRUE(len.ok());
  EXPECT_EQ(len.value(), 5u);
  // Position should not change
  EXPECT_EQ(decoder.position(), 0u);
}

TEST(CborDecoder, PeekStringLengthBytes) {
  // bytes(10)
  constexpr std::array<std::byte, 11> data = {
      std::byte{0x4a},  // bytes(10)
      std::byte{0}, std::byte{1}, std::byte{2}, std::byte{3}, std::byte{4},
      std::byte{5}, std::byte{6}, std::byte{7}, std::byte{8}, std::byte{9}};
  Decoder decoder(data);

  auto len = decoder.PeekStringLength();
  ASSERT_TRUE(len.ok());
  EXPECT_EQ(len.value(), 10u);
  EXPECT_EQ(decoder.position(), 0u);
}

TEST(CborDecoder, PeekStringLengthOneByte) {
  // text(100) - 1-byte length
  std::array<std::byte, 102> data{};
  data[0] = std::byte{0x78};  // text(1-byte len follows)
  data[1] = std::byte{100};   // length = 100
  Decoder decoder(data);

  auto len = decoder.PeekStringLength();
  ASSERT_TRUE(len.ok());
  EXPECT_EQ(len.value(), 100u);
  EXPECT_EQ(decoder.position(), 0u);
}

TEST(CborDecoder, PeekStringLengthTwoBytes) {
  // text(1000) - 2-byte length
  std::array<std::byte, 1003> data{};
  data[0] = std::byte{0x79};  // text(2-byte len follows)
  data[1] = std::byte{0x03};  // high byte
  data[2] = std::byte{0xe8};  // low byte (0x03e8 = 1000)
  Decoder decoder(data);

  auto len = decoder.PeekStringLength();
  ASSERT_TRUE(len.ok());
  EXPECT_EQ(len.value(), 1000u);
  EXPECT_EQ(decoder.position(), 0u);
}

TEST(CborDecoder, PeekStringLengthNotString) {
  // unsigned int - should fail
  constexpr std::array<std::byte, 1> data = {std::byte{0x18}};
  Decoder decoder(data);

  auto len = decoder.PeekStringLength();
  EXPECT_FALSE(len.ok());
  EXPECT_EQ(len.status().code(), pw::Status::FailedPrecondition().code());
}

}  // namespace
}  // namespace pb::cloud::cbor
