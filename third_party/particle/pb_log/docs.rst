.. _module-pb_log:

======
pb_log
======
Bridge from Particle Device OS logging to ``pw_log``.

This module intercepts all Device OS system logs and routes them through
Pigweed's logging system, providing unified log output.

-----
Setup
-----
Add the dependency and call ``InitLogBridge()`` early in your application:

.. code-block:: python

   deps = [
       "@particle_bazel//pb_log:log_bridge",
       "@pigweed//pw_log",
   ],

-----
Usage
-----
Initialize the bridge in your setup function:

.. code-block:: cpp

   #include "pb_log/log_bridge.h"
   #include "pw_log/log.h"

   void setup() {
     pb::log::InitLogBridge();

     // Now all logs (both pw_log and Device OS) go to USB serial
     PW_LOG_INFO("Application started");
   }

After initialization, you'll see both your application logs and Device OS
system logs (WiFi, cloud connection, etc.) in the serial output.

Log Level Mapping
=================
Device OS log levels are mapped to ``pw_log`` levels:

.. list-table::
   :header-rows: 1

   * - Device OS Level
     - pw_log Level
   * - PANIC (60)
     - ``PW_LOG_CRITICAL``
   * - ERROR (50)
     - ``PW_LOG_ERROR``
   * - WARN (40)
     - ``PW_LOG_WARN``
   * - INFO (30)
     - ``PW_LOG_INFO``
   * - TRACE (1)
     - ``PW_LOG_DEBUG``

Example Output
==============
.. code-block:: text

   INF Application started
   INF [system] Device ID: e00fce68...
   INF [comm] Cloud connecting...
   DBG [system] WiFi RSSI: -45 dBm
   INF [comm] Cloud connected

-----------------------
Implementation Details
-----------------------
- Uses ``log_set_callbacks()`` to intercept Device OS logs
- Callbacks route messages through ``pw_log`` macros
- Raw write callback uses ``pw_sys_io::WriteByte()`` for direct output
- Thread-safe via ``pw_sys_io``'s internal mutex
- All Device OS log levels are enabled (filtering done by ``pw_log``)

.. note::

   Call ``InitLogBridge()`` early in ``setup()`` before any significant
   initialization. Otherwise, early Device OS log messages may be lost.

----------
Bazel Targets
----------
- ``//pb_log:log_bridge`` - Log bridge implementation
