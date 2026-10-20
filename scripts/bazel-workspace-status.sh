#!/usr/bin/env bash
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT
#
# Bazel workspace status for --config=prod (.bazelrc): the release version
# the firmware reports (ADR-0045), from the same script as every other
# component. Runs from the workspace root. `./pw prod-flash` cuts or reuses
# the release tag before building, so a clean prod build resolves to it.
set -euo pipefail
echo "STABLE_MACO_BUILD_VERSION $(npx --no-install tsx scripts/deploy/build-version.ts)"
