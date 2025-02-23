#pragma once

// Generic success/fail return status.
enum class Status {
  kOk = 0,
  kError = 1,
  kTimeout = 2,
};
