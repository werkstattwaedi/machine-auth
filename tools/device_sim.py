# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""MACO device simulator - launches simulator and connects console.

Wraps pw_system's device_sim with project-specific RPC protos.

Usage:
    bazel run //maco_firmware/apps/dev:console_sim
"""

import sys

from pw_system import device_sim
from maco_pb import maco_service_pb2
from maco_pb import nfc_mock_service_pb2


def main() -> int:
    return device_sim.main(compiled_protos=[maco_service_pb2, nfc_mock_service_pb2])


if __name__ == "__main__":
    sys.exit(main())
