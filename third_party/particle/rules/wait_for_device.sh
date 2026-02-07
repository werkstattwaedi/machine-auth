#!/bin/bash
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT
#
# Wait for a Particle device to appear on USB.
# Usage: wait_for_device.sh [timeout_seconds]
#   timeout_seconds: Maximum time to wait (default: 15)
#
# Exit codes:
#   0 - Device found
#   1 - Timeout reached

TIMEOUT="${1:-15}"
START_TIME=$(date +%s)
LAST_MSG_TIME=0

while true; do
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))

    if particle serial list 2>/dev/null | grep -q "ttyACM\|ttyUSB"; then
        echo "Device found!"
        exit 0
    fi

    if [ $ELAPSED -ge $TIMEOUT ]; then
        echo "Error: Device did not appear within $TIMEOUT seconds"
        exit 1
    fi

    # Print progress once per second
    if [ $CURRENT_TIME -gt $LAST_MSG_TIME ]; then
        echo "Waiting for device... ($ELAPSED/$TIMEOUT)"
        LAST_MSG_TIME=$CURRENT_TIME
    fi
done
