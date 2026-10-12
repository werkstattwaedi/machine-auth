// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

namespace maco {

// Release version this firmware was built as (ADR-0045), e.g. "2026.10.3"
// or "2026.10.3-dev.4+g1a2b3c4d". Stamped by Bazel's workspace status under
// --config=prod (scripts/bazel-workspace-status.sh); every other build says
// "dev", so a commit doesn't invalidate the dev build cache.
extern const char kBuildVersion[];

}  // namespace maco
