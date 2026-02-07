// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file mock_tcp_socket.h
/// @brief Mock TCP socket for host testing.

#include <deque>
#include <vector>

#include "pb_socket/tcp_socket.h"

namespace pb::socket {

/// Mock TCP socket for testing.
///
/// Provides a fake TCP socket that can be pre-loaded with data to read
/// and captures written data for verification.
///
/// Usage:
/// @code
///   MockTcpSocket mock;
///   mock.set_connected(true);
///   mock.EnqueueReadData(pw::bytes::Array<0x7E, 0x00>());
///
///   // Use mock with code under test
///   std::byte buffer[64];
///   auto result = mock.Read(buffer);
///
///   // Verify written data
///   auto written = mock.PopWrittenData();
/// @endcode
class MockTcpSocket : public TcpSocket {
 public:
  MockTcpSocket() = default;

  // TcpSocket interface
  pw::Status Connect() override {
    if (connect_should_fail_) {
      state_ = TcpState::kError;
      return connect_error_;
    }
    state_ = TcpState::kConnected;
    return pw::OkStatus();
  }

  void Disconnect() override { state_ = TcpState::kDisconnected; }

  bool IsConnected() const override { return state_ == TcpState::kConnected; }

  TcpState state() const override { return state_; }

  int last_error() const override { return last_error_; }

  pw::StatusWithSize Read(pw::ByteSpan dest) override {
    if (state_ != TcpState::kConnected) {
      return pw::StatusWithSize::FailedPrecondition();
    }

    if (read_queue_.empty()) {
      return pw::StatusWithSize(0);  // No data available
    }

    auto& front = read_queue_.front();
    size_t to_copy = std::min(dest.size(), front.size());
    std::copy(front.begin(), front.begin() + to_copy, dest.begin());
    front.erase(front.begin(), front.begin() + to_copy);

    if (front.empty()) {
      read_queue_.pop_front();
    }

    return pw::StatusWithSize(to_copy);
  }

  pw::Status Write(pw::ConstByteSpan data) override {
    if (state_ != TcpState::kConnected) {
      return pw::Status::FailedPrecondition();
    }

    written_data_.insert(written_data_.end(), data.begin(), data.end());
    return pw::OkStatus();
  }

  // Mock configuration
  void set_connected(bool connected) {
    state_ = connected ? TcpState::kConnected : TcpState::kDisconnected;
  }

  void set_connect_should_fail(bool fail, pw::Status error = pw::Status::Unavailable()) {
    connect_should_fail_ = fail;
    connect_error_ = error;
  }

  /// Enqueue data to be returned by Read().
  void EnqueueReadData(pw::ConstByteSpan data) {
    read_queue_.emplace_back(data.begin(), data.end());
  }

  /// Get data written via Write() and remove it from the buffer.
  std::vector<std::byte> PopWrittenData() {
    std::vector<std::byte> result;
    std::swap(result, written_data_);
    return result;
  }

  /// Get all data written via Write() without removing it.
  const std::vector<std::byte>& written_data() const { return written_data_; }

  /// Clear all queued read data and written data.
  void Clear() {
    read_queue_.clear();
    written_data_.clear();
  }

 private:
  TcpState state_ = TcpState::kDisconnected;
  int last_error_ = 0;
  bool connect_should_fail_ = false;
  pw::Status connect_error_ = pw::Status::Unavailable();

  std::deque<std::vector<std::byte>> read_queue_;
  std::vector<std::byte> written_data_;
};

}  // namespace pb::socket
