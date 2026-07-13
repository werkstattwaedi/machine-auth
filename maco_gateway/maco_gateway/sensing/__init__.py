# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Machine-activity sensing: lease-managed background probers (ADR-0035).

The gateway runs the device-specific protocol (e.g. the xTool laser's TLS
WebSocket) on behalf of the terminal, which leases a sensing session and polls
it over the local RPC. Keeps all vendor-protocol churn out of the firmware.
"""
