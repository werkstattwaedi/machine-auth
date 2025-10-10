#pragma once

enum class ErrorType {
  kUnspecified = 1,
  kTimeout = 2,
  kWrongState = 3,
  kMalformedResponse = 4,
  kServerError = 5,
  kUnexpectedState = 6,
  kCloudError = 7,  // Cloud hook returned an error

  kNoNfcTag = 10,
  kNtagFailed = 10,

};

// Generic success/fail return status.
enum class Status {
  kOk = 0,
  kError = (int)ErrorType::kUnspecified,
  kTimeout = (int)ErrorType::kTimeout,
};
