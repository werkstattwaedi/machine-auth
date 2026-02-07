// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pb_cloud/cbor.h"

#include <cstring>

#include "pw_status/try.h"

namespace pb::cloud::cbor {

// -- Encoder Implementation --

Encoder::Encoder(pw::ByteSpan buffer) : buffer_(buffer) {}

pw::Status Encoder::BeginMap(size_t count) {
  return WriteHeader(MajorType::kMap, count);
}

pw::Status Encoder::WriteNull(std::string_view key) {
  PW_TRY(WriteKey(key));
  // null is simple value 22 (0xf6)
  if (remaining() < 1) {
    return pw::Status::ResourceExhausted();
  }
  buffer_[pos_++] = static_cast<std::byte>(0xe0 | static_cast<uint8_t>(SimpleValue::kNull));
  return pw::OkStatus();
}

pw::Status Encoder::WriteBool(std::string_view key, bool value) {
  PW_TRY(WriteKey(key));
  if (remaining() < 1) {
    return pw::Status::ResourceExhausted();
  }
  // false = 0xf4, true = 0xf5
  auto simple = value ? SimpleValue::kTrue : SimpleValue::kFalse;
  buffer_[pos_++] = static_cast<std::byte>(0xe0 | static_cast<uint8_t>(simple));
  return pw::OkStatus();
}

pw::Status Encoder::WriteInt(std::string_view key, int64_t value) {
  PW_TRY(WriteKey(key));
  if (value >= 0) {
    return WriteHeader(MajorType::kUnsignedInt, static_cast<uint64_t>(value));
  }
  // Negative: encode as -(1+n), so -1 is 0x20 (n=0), -10 is 0x29 (n=9)
  return WriteHeader(MajorType::kNegativeInt, static_cast<uint64_t>(-1 - value));
}

pw::Status Encoder::WriteUint(std::string_view key, uint64_t value) {
  PW_TRY(WriteKey(key));
  return WriteHeader(MajorType::kUnsignedInt, value);
}

pw::Status Encoder::WriteDouble(std::string_view key, double value) {
  PW_TRY(WriteKey(key));
  // Always use 8-byte float (0xfb)
  if (remaining() < 9) {
    return pw::Status::ResourceExhausted();
  }
  buffer_[pos_++] = static_cast<std::byte>(0xfb);

  // Write IEEE 754 double in big-endian
  uint64_t bits;
  std::memcpy(&bits, &value, sizeof(bits));
  for (int i = 7; i >= 0; --i) {
    buffer_[pos_++] = static_cast<std::byte>((bits >> (i * 8)) & 0xff);
  }
  return pw::OkStatus();
}

pw::Status Encoder::WriteString(std::string_view key, std::string_view value) {
  PW_TRY(WriteKey(key));
  PW_TRY(WriteHeader(MajorType::kTextString, value.size()));
  return WriteRaw(value.data(), value.size());
}

pw::Status Encoder::WriteBytes(std::string_view key, pw::ConstByteSpan value) {
  PW_TRY(WriteKey(key));
  PW_TRY(WriteHeader(MajorType::kByteString, value.size()));
  return WriteRaw(value.data(), value.size());
}

pw::Status Encoder::WriteHeader(MajorType type, uint64_t argument) {
  uint8_t major = static_cast<uint8_t>(type) << 5;

  if (argument < 24) {
    // Encode in initial byte
    if (remaining() < 1) {
      return pw::Status::ResourceExhausted();
    }
    buffer_[pos_++] = static_cast<std::byte>(major | argument);
  } else if (argument <= 0xff) {
    // 1-byte argument
    if (remaining() < 2) {
      return pw::Status::ResourceExhausted();
    }
    buffer_[pos_++] = static_cast<std::byte>(major | 24);
    buffer_[pos_++] = static_cast<std::byte>(argument);
  } else if (argument <= 0xffff) {
    // 2-byte argument
    if (remaining() < 3) {
      return pw::Status::ResourceExhausted();
    }
    buffer_[pos_++] = static_cast<std::byte>(major | 25);
    buffer_[pos_++] = static_cast<std::byte>(argument >> 8);
    buffer_[pos_++] = static_cast<std::byte>(argument);
  } else if (argument <= 0xffffffff) {
    // 4-byte argument
    if (remaining() < 5) {
      return pw::Status::ResourceExhausted();
    }
    buffer_[pos_++] = static_cast<std::byte>(major | 26);
    buffer_[pos_++] = static_cast<std::byte>(argument >> 24);
    buffer_[pos_++] = static_cast<std::byte>(argument >> 16);
    buffer_[pos_++] = static_cast<std::byte>(argument >> 8);
    buffer_[pos_++] = static_cast<std::byte>(argument);
  } else {
    // 8-byte argument
    if (remaining() < 9) {
      return pw::Status::ResourceExhausted();
    }
    buffer_[pos_++] = static_cast<std::byte>(major | 27);
    for (int i = 7; i >= 0; --i) {
      buffer_[pos_++] = static_cast<std::byte>(argument >> (i * 8));
    }
  }
  return pw::OkStatus();
}

pw::Status Encoder::WriteKey(std::string_view key) {
  PW_TRY(WriteHeader(MajorType::kTextString, key.size()));
  return WriteRaw(key.data(), key.size());
}

pw::Status Encoder::WriteRaw(const void* data, size_t len) {
  if (remaining() < len) {
    return pw::Status::ResourceExhausted();
  }
  std::memcpy(buffer_.data() + pos_, data, len);
  pos_ += len;
  return pw::OkStatus();
}

// -- Decoder Implementation --

Decoder::Decoder(pw::ConstByteSpan data) : data_(data) {}

pw::Result<size_t> Decoder::ReadMapHeader() {
  auto result = ReadHeader(MajorType::kMap);
  if (!result.ok()) {
    return result.status();
  }
  return static_cast<size_t>(result.value());
}

pw::Result<std::string_view> Decoder::ReadKey(pw::ByteSpan key_buffer) {
  auto len_result = ReadHeader(MajorType::kTextString);
  if (!len_result.ok()) {
    return len_result.status();
  }
  size_t len = static_cast<size_t>(len_result.value());

  if (len > key_buffer.size()) {
    return pw::Status::ResourceExhausted();
  }

  PW_TRY(ReadRaw(key_buffer.data(), len));
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  return std::string_view(reinterpret_cast<const char*>(key_buffer.data()), len);
}

pw::Result<MajorType> Decoder::PeekType() const {
  auto byte_result = PeekByte();
  if (!byte_result.ok()) {
    return byte_result.status();
  }
  return static_cast<MajorType>(byte_result.value() >> 5);
}

pw::Result<bool> Decoder::ReadBool() {
  auto byte_result = PeekByte();
  if (!byte_result.ok()) {
    return byte_result.status();
  }

  uint8_t byte = byte_result.value();
  if (byte == 0xf4) {  // false
    ++pos_;
    return false;
  }
  if (byte == 0xf5) {  // true
    ++pos_;
    return true;
  }
  return pw::Status::DataLoss();  // Type mismatch
}

pw::Result<int64_t> Decoder::ReadInt() {
  auto result = ReadHeaderAny();
  if (!result.ok()) {
    return result.status();
  }

  auto [type, value] = result.value();

  if (type == MajorType::kUnsignedInt) {
    if (value > static_cast<uint64_t>(INT64_MAX)) {
      return pw::Status::OutOfRange();
    }
    return static_cast<int64_t>(value);
  }

  if (type == MajorType::kNegativeInt) {
    // Negative: -1 - value
    if (value > static_cast<uint64_t>(INT64_MAX)) {
      return pw::Status::OutOfRange();
    }
    return -1 - static_cast<int64_t>(value);
  }

  return pw::Status::DataLoss();  // Type mismatch
}

pw::Result<uint64_t> Decoder::ReadUint() {
  auto result = ReadHeader(MajorType::kUnsignedInt);
  if (!result.ok()) {
    return result.status();
  }
  return result.value();
}

pw::Result<double> Decoder::ReadDouble() {
  auto byte_result = PeekByte();
  if (!byte_result.ok()) {
    return byte_result.status();
  }

  uint8_t initial = byte_result.value();
  MajorType type = static_cast<MajorType>(initial >> 5);

  // Handle integer types by converting to double
  if (type == MajorType::kUnsignedInt || type == MajorType::kNegativeInt) {
    auto int_result = ReadInt();
    if (!int_result.ok()) {
      return int_result.status();
    }
    return static_cast<double>(int_result.value());
  }

  // Must be float type
  if (initial != 0xfb) {  // 8-byte float
    // Could support 0xf9 (half), 0xfa (float), but Particle uses 0xfb
    return pw::Status::DataLoss();
  }

  ++pos_;  // Consume the 0xfb byte

  if (data_.size() - pos_ < 8) {
    return pw::Status::DataLoss();
  }

  uint64_t bits = 0;
  for (int i = 0; i < 8; ++i) {
    bits = (bits << 8) | static_cast<uint8_t>(data_[pos_++]);
  }

  double value;
  std::memcpy(&value, &bits, sizeof(value));
  return value;
}

pw::Result<size_t> Decoder::ReadString(pw::ByteSpan buffer) {
  auto len_result = ReadHeader(MajorType::kTextString);
  if (!len_result.ok()) {
    return len_result.status();
  }
  size_t len = static_cast<size_t>(len_result.value());

  if (len > buffer.size()) {
    return pw::Status::ResourceExhausted();
  }

  PW_TRY(ReadRaw(buffer.data(), len));
  return len;
}

pw::Result<size_t> Decoder::ReadBytes(pw::ByteSpan buffer) {
  auto len_result = ReadHeader(MajorType::kByteString);
  if (!len_result.ok()) {
    return len_result.status();
  }
  size_t len = static_cast<size_t>(len_result.value());

  if (len > buffer.size()) {
    return pw::Status::ResourceExhausted();
  }

  PW_TRY(ReadRaw(buffer.data(), len));
  return len;
}

pw::Status Decoder::SkipValue() {
  auto result = ReadHeaderAny();
  if (!result.ok()) {
    return result.status();
  }

  auto [type, argument] = result.value();

  switch (type) {
    case MajorType::kUnsignedInt:
    case MajorType::kNegativeInt:
      // Already consumed by ReadHeaderAny
      return pw::OkStatus();

    case MajorType::kByteString:
    case MajorType::kTextString:
      // Skip the string content
      if (argument > data_.size() - pos_) {
        return pw::Status::DataLoss();
      }
      pos_ += static_cast<size_t>(argument);
      return pw::OkStatus();

    case MajorType::kArray:
      // Skip all array elements
      for (uint64_t i = 0; i < argument; ++i) {
        PW_TRY(SkipValue());
      }
      return pw::OkStatus();

    case MajorType::kMap:
      // Skip all key-value pairs
      for (uint64_t i = 0; i < argument; ++i) {
        PW_TRY(SkipValue());  // key
        PW_TRY(SkipValue());  // value
      }
      return pw::OkStatus();

    case MajorType::kSimpleFloat: {
      // Handle special simple values and floats
      // argument here is the additional info (5 bits)
      if (argument <= 23) {
        // Simple value in initial byte, already consumed
        return pw::OkStatus();
      }
      if (argument == 24) {
        // Simple value in next byte
        if (pos_ >= data_.size()) {
          return pw::Status::DataLoss();
        }
        ++pos_;
        return pw::OkStatus();
      }
      if (argument == 25) {
        // Half-precision float (2 bytes)
        if (data_.size() - pos_ < 2) {
          return pw::Status::DataLoss();
        }
        pos_ += 2;
        return pw::OkStatus();
      }
      if (argument == 26) {
        // Single-precision float (4 bytes)
        if (data_.size() - pos_ < 4) {
          return pw::Status::DataLoss();
        }
        pos_ += 4;
        return pw::OkStatus();
      }
      if (argument == 27) {
        // Double-precision float (8 bytes)
        if (data_.size() - pos_ < 8) {
          return pw::Status::DataLoss();
        }
        pos_ += 8;
        return pw::OkStatus();
      }
      return pw::Status::DataLoss();  // Invalid simple value
    }

    case MajorType::kTag:
      // Skip the tag and its content
      return SkipValue();
  }

  return pw::Status::DataLoss();
}

pw::Result<uint64_t> Decoder::ReadHeader(MajorType expected_type) {
  auto result = ReadHeaderAny();
  if (!result.ok()) {
    return result.status();
  }
  if (result.value().first != expected_type) {
    return pw::Status::DataLoss();  // Type mismatch
  }
  return result.value().second;
}

pw::Result<std::pair<MajorType, uint64_t>> Decoder::ReadHeaderAny() {
  if (pos_ >= data_.size()) {
    return pw::Status::DataLoss();
  }

  uint8_t initial = static_cast<uint8_t>(data_[pos_++]);
  MajorType type = static_cast<MajorType>(initial >> 5);
  uint8_t additional = initial & 0x1f;

  uint64_t argument;

  if (additional < 24) {
    argument = additional;
  } else if (additional == 24) {
    if (pos_ >= data_.size()) {
      return pw::Status::DataLoss();
    }
    argument = static_cast<uint8_t>(data_[pos_++]);
  } else if (additional == 25) {
    if (data_.size() - pos_ < 2) {
      return pw::Status::DataLoss();
    }
    argument = (static_cast<uint64_t>(static_cast<uint8_t>(data_[pos_])) << 8) |
               static_cast<uint64_t>(static_cast<uint8_t>(data_[pos_ + 1]));
    pos_ += 2;
  } else if (additional == 26) {
    if (data_.size() - pos_ < 4) {
      return pw::Status::DataLoss();
    }
    argument = 0;
    for (int i = 0; i < 4; ++i) {
      argument = (argument << 8) | static_cast<uint8_t>(data_[pos_++]);
    }
  } else if (additional == 27) {
    if (data_.size() - pos_ < 8) {
      return pw::Status::DataLoss();
    }
    argument = 0;
    for (int i = 0; i < 8; ++i) {
      argument = (argument << 8) | static_cast<uint8_t>(data_[pos_++]);
    }
  } else {
    // Indefinite length (28-30) or break (31) - not supported
    return pw::Status::Unimplemented();
  }

  return std::make_pair(type, argument);
}

pw::Status Decoder::ReadRaw(void* data, size_t len) {
  if (data_.size() - pos_ < len) {
    return pw::Status::DataLoss();
  }
  std::memcpy(data, data_.data() + pos_, len);
  pos_ += len;
  return pw::OkStatus();
}

pw::Result<uint8_t> Decoder::PeekByte() const {
  if (pos_ >= data_.size()) {
    return pw::Status::DataLoss();
  }
  return static_cast<uint8_t>(data_[pos_]);
}

pw::Result<size_t> Decoder::PeekStringLength() const {
  if (pos_ >= data_.size()) {
    return pw::Status::DataLoss();
  }

  uint8_t initial = static_cast<uint8_t>(data_[pos_]);
  MajorType type = static_cast<MajorType>(initial >> 5);

  // Must be byte string or text string
  if (type != MajorType::kByteString && type != MajorType::kTextString) {
    return pw::Status::FailedPrecondition();
  }

  uint8_t additional = initial & 0x1f;
  size_t header_pos = pos_ + 1;

  uint64_t length;
  if (additional < 24) {
    length = additional;
  } else if (additional == 24) {
    if (header_pos >= data_.size()) {
      return pw::Status::DataLoss();
    }
    length = static_cast<uint8_t>(data_[header_pos]);
  } else if (additional == 25) {
    if (data_.size() - header_pos < 2) {
      return pw::Status::DataLoss();
    }
    length = (static_cast<uint64_t>(static_cast<uint8_t>(data_[header_pos])) << 8) |
             static_cast<uint64_t>(static_cast<uint8_t>(data_[header_pos + 1]));
  } else if (additional == 26) {
    if (data_.size() - header_pos < 4) {
      return pw::Status::DataLoss();
    }
    length = 0;
    for (int i = 0; i < 4; ++i) {
      length = (length << 8) | static_cast<uint8_t>(data_[header_pos + i]);
    }
  } else if (additional == 27) {
    if (data_.size() - header_pos < 8) {
      return pw::Status::DataLoss();
    }
    length = 0;
    for (int i = 0; i < 8; ++i) {
      length = (length << 8) | static_cast<uint8_t>(data_[header_pos + i]);
    }
  } else {
    // Indefinite length not supported
    return pw::Status::Unimplemented();
  }

  return static_cast<size_t>(length);
}

}  // namespace pb::cloud::cbor
